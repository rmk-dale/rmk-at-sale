/**
 * End-to-end check for the checkout concurrency gate in lib/checkoutGate.ts.
 *
 *   npm run check:gate
 *
 * The gate is a Redis sorted-set semaphore driven by a Lua script, and
 * that script never runs in development — `next dev` falls back to the
 * in-process path. So, exactly like scripts/check-ratelimit.ts, this is
 * the only place the real thing is exercised. Run it from your machine
 * after setting the Upstash credentials.
 *
 * Exercises the four properties the checkout route depends on:
 *   1. slots are granted up to the limit and refused past it
 *   2. the limit holds under concurrency — this is what the Lua is for,
 *      since a read-then-write semaphore over-admits here
 *   3. releasing a slot returns capacity
 *   4. an abandoned lease (a crashed function) expires instead of eating
 *      capacity forever
 *
 * Writes only to a `gate:selftest:*` key carrying its own TTL, so it never
 * touches the live `gate:checkout` key and cannot block real checkouts.
 */
import { readFileSync, existsSync } from "fs";
import path from "path";
import crypto from "crypto";

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

const { upstashCommand, UPSTASH_CONFIGURED } = await import("../lib/upstash.ts");
const { ACQUIRE_LUA } = await import("../lib/checkoutGate.ts");

if (!UPSTASH_CONFIGURED) {
  console.error(
    "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set.\n" +
      "This script tests the Redis path specifically — there is nothing to check without them.",
  );
  process.exit(1);
}

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

const KEY = `gate:selftest:${Date.now()}`;
const MAX = 3;
const TTL_MS = 4000;

/** Runs the real acquire script against the isolated test key. */
async function acquire(ttlMs = TTL_MS): Promise<string | null> {
  const member = crypto.randomBytes(8).toString("hex");
  const admitted = Number(
    await upstashCommand([
      "EVAL",
      ACQUIRE_LUA,
      "1",
      KEY,
      String(Date.now()),
      String(ttlMs),
      String(MAX),
      member,
    ]),
  );
  return admitted === 1 ? member : null;
}

async function release(member: string) {
  await upstashCommand(["ZREM", KEY, member]);
}

async function inFlight(): Promise<number> {
  return Number(await upstashCommand(["ZCARD", KEY]));
}

console.log("Backend: Upstash Redis (sorted-set semaphore)\n");

// 1. Sequential: the first MAX are admitted, the next are refused.
const held: string[] = [];
for (let i = 0; i < MAX + 2; i++) {
  const lease = await acquire();
  if (lease) held.push(lease);
}
check(
  `first ${MAX} admitted, the rest refused`,
  held.length === MAX,
  `${held.length} admitted of ${MAX + 2} attempts`,
);

// 2. Release returns capacity.
await release(held[0]);
const afterRelease = await acquire();
check("a released slot can be taken again", afterRelease !== null);
if (afterRelease) held[0] = afterRelease;

// 3. Concurrency — the property the Lua script exists for.
//    Drain first so the race starts from an empty gate.
for (const lease of held) await release(lease);
check("gate is empty before the race", (await inFlight()) === 0);

const race = await Promise.all(Array.from({ length: 10 }, () => acquire()));
const admitted = race.filter(Boolean).length;
check(
  `exactly ${MAX} of 10 concurrent acquires admitted`,
  admitted === MAX,
  `${admitted} admitted`,
);

// 4. Abandoned leases expire rather than permanently shrinking capacity.
//    Nothing is released here — this simulates functions killed mid-checkout.
console.log("  … waiting out the lease TTL");
await new Promise((r) => setTimeout(r, TTL_MS + 500));
const afterExpiry = await acquire();
check(
  "a slot is available again once abandoned leases expire",
  afterExpiry !== null,
);

await upstashCommand(["DEL", KEY]);

console.log(
  failed === 0
    ? "\nAll checkout gate checks passed.\n"
    : `\n${failed} check(s) failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
