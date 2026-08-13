/**
 * Counts the Atlas operations the admin read paths actually send.
 * Run with `npm run check:admin-cache` (reads MONGODB_URI from .env.local).
 *
 * The point is that a cache is invisible from the outside: the screen looks
 * identical whether it hit memory or spent a round trip. The only way to
 * know is to count commands on the wire, which is what MONGO_DEBUG_COMMANDS
 * turns on in lib/mongodb.ts.
 *
 * What this asserts, in order:
 *
 *   1. Repeat reads inside the TTL cost nothing. This is the whole saving —
 *      an admin clicking between tabs stops re-querying the collection.
 *   2. Concurrent cold reads collapse into one query, so a burst can't
 *      multiply into N queries against a shared-tier cluster.
 *   3. An invalidation forces the next read back to Atlas. Without this the
 *      saving would come at the cost of an admin not seeing their own edit,
 *      which is not a trade worth making.
 *
 * Read-only: it queries the products and brands collections and writes
 * nothing.
 */
import { readFileSync, existsSync } from "fs";
import path from "path";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is not set — add it to .env.local first.");
  process.exit(1);
}

// Must be set before lib/mongodb.ts is evaluated, which is why every import
// below is dynamic: a static `import` would be hoisted above this line and
// the client would be built without command monitoring.
process.env.MONGO_DEBUG_COMMANDS = "1";

const { default: clientPromise } = await import("../lib/mongodb.ts");
const { getAdminProducts, invalidatePublicProductsCache } = await import(
  "../lib/models/product.ts"
);
const { getAdminBrands, invalidatePublicBrandsCache } = await import(
  "../lib/models/brand.ts"
);

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const client = await clientPromise;

// Only the commands that represent real query work. The driver also sends
// handshakes and heartbeats (`hello`, `ping`), which say nothing about
// whether the app is over-fetching and would just add noise.
const COUNTED = new Set(["find", "aggregate", "count", "distinct"]);
let commands = 0;
client.on("commandStarted", (event) => {
  if (COUNTED.has(event.commandName)) commands++;
});

async function measure(fn: () => Promise<unknown>): Promise<number> {
  const before = commands;
  await fn();
  return commands - before;
}

// ---------------------------------------------------------------------------

console.log("\nproducts: repeat reads inside the TTL are free");
{
  invalidatePublicProductsCache();
  const cold = await measure(getAdminProducts);
  const warm1 = await measure(getAdminProducts);
  const warm2 = await measure(getAdminProducts);

  check("the first read queries Atlas", cold === 1, `saw ${cold}`);
  check(
    "the next two reads query nothing",
    warm1 === 0 && warm2 === 0,
    `saw ${warm1} and ${warm2}`,
  );
}

console.log("\nproducts: a burst of cold readers collapses into one query");
{
  invalidatePublicProductsCache();
  const used = await measure(() =>
    Promise.all(Array.from({ length: 8 }, () => getAdminProducts())),
  );
  check("eight concurrent readers cost one query", used === 1, `saw ${used}`);
}

console.log("\nproducts: a write sends the next read back to Atlas");
{
  await getAdminProducts(); // warm it
  invalidatePublicProductsCache(); // what a POST/PATCH triggers
  const after = await measure(getAdminProducts);
  check("the read after an invalidation is a miss", after === 1, `saw ${after}`);
}

console.log("\nbrands: same contract");
{
  invalidatePublicBrandsCache();
  const cold = await measure(getAdminBrands);
  const warm = await measure(getAdminBrands);
  invalidatePublicBrandsCache();
  const afterWrite = await measure(getAdminBrands);

  check("cold read queries once", cold === 1, `saw ${cold}`);
  check("warm read queries nothing", warm === 0, `saw ${warm}`);
  check(
    "read after invalidation queries again",
    afterWrite === 1,
    `saw ${afterWrite}`,
  );
}

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
console.log(
  "\nFor reference: a visit to /admin now costs at most 1 product query" +
    "\nplus 1 requireAdmin lookup. Before, the page fetched" +
    "\n/api/admin/products from the browser on every mount, which cost a" +
    "\nsecond requireAdmin lookup and an uncached query every time.\n",
);

await client.close();
process.exit(failed === 0 ? 0 : 1);
