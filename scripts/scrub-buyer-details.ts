/**
 * Removes outside buyers' contact details from orders past the retention
 * window stated in the Data Privacy Policy.
 *
 *   npm run scrub:buyers            # dry run — reports, changes nothing
 *   npm run scrub:buyers -- --apply # actually writes
 *   npm run scrub:buyers -- --days=365 --apply
 *
 * This script is the mechanism behind a promise. The privacy notice in the
 * cart tells buyers we remove their name, company and contact number once
 * the retention window has passed; nothing in the application does that on
 * its own, so without this the notice is a commitment with nothing behind
 * it — which is worse than not having made it.
 *
 * What it removes: buyerName, buyerCompany, buyerPhone.
 *
 * What it deliberately keeps:
 *   - the order, its items and its totals, so sales history survives
 *   - buyerEmail, which is the order's identity and how a buyer asking
 *     about their own order is found; the notice does not promise its
 *     removal
 *   - affiliationDeclaredAt / affiliationVersion, which record that a
 *     declaration was made rather than anything about the person. That is
 *     the audit trail behind any cancellation, and it has to outlive the
 *     contact details it sat beside.
 *
 * Idempotent: it only matches orders that still have at least one of the
 * three fields, so running it twice is harmless. Dry by default, because
 * this is the one script here that destroys data.
 */
import { MongoClient } from "mongodb";
import dns from "dns";
import { readFileSync, existsSync } from "fs";
import path from "path";

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {
  // Ignore in environments where this isn't allowed.
}

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

/**
 * Default window, in days.
 *
 * MUST match the figure in the Data Privacy Policy modal in
 * app/cart/page.tsx (RETENTION_AFTER_SALE). If the two ever disagree, the
 * notice is the promise and this is the thing breaking it — change the
 * notice first, then this.
 */
const DEFAULT_RETENTION_DAYS = 180;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const daysArg = args.find((arg) => arg.startsWith("--days="));
const days = daysArg ? Number(daysArg.slice("--days=".length)) : DEFAULT_RETENTION_DAYS;

if (!Number.isInteger(days) || days < 1) {
  console.error(`Invalid --days value: ${daysArg}`);
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is not set.");

const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const client = new MongoClient(uri);
await client.connect();

const orders = client.db().collection("orders");

// Only external orders carry these fields at all, but the filter asks for
// the fields rather than the buyer type: that way an order whose type was
// somehow never set still gets cleaned if it is holding contact details.
const filter = {
  createdAt: { $lt: cutoff },
  $or: [
    { buyerName: { $exists: true } },
    { buyerCompany: { $exists: true } },
    { buyerPhone: { $exists: true } },
  ],
};

const pending = await orders
  .find(filter, { projection: { orderNumber: 1, createdAt: 1, buyerCompany: 1 } })
  .sort({ createdAt: 1 })
  .toArray();

console.log(
  `\nRetention window: ${days} days (orders created before ${cutoff.toISOString().slice(0, 10)})`,
);
console.log(`Orders still holding contact details: ${pending.length}\n`);

for (const order of pending.slice(0, 20)) {
  const created = new Date(order.createdAt as string | number | Date)
    .toISOString()
    .slice(0, 10);
  console.log(
    `  ${order.orderNumber ?? order._id}  ${created}  ${order.buyerCompany ?? "—"}`,
  );
}
if (pending.length > 20) console.log(`  … and ${pending.length - 20} more`);

if (pending.length === 0) {
  console.log("Nothing to do.\n");
  await client.close();
  process.exit(0);
}

if (!apply) {
  console.log(
    "\nDry run — nothing was changed. Re-run with --apply to remove these details.\n",
  );
  await client.close();
  process.exit(0);
}

const result = await orders.updateMany(filter, {
  $unset: { buyerName: "", buyerCompany: "", buyerPhone: "" },
});

console.log(
  `\nRemoved name, company and contact number from ${result.modifiedCount} order(s).`,
);
console.log(
  "Items, totals and the declaration record were left intact.\n",
);

await client.close();
