/**
 * Backfills orders created before order tracking existed.
 *
 * Adds, for each order missing them:
 *   - `orderNumber`  a tracking reference, allocated in creation order so
 *                    the sequence matches the order book's real history
 *   - `stockReleased` derived from the current status (a cancelled order
 *                    has already had its stock returned)
 *   - `statusHistory` a single synthetic entry recording the current state,
 *                    marked so nobody mistakes it for a real audit record
 *
 * Idempotent: only touches documents that lack `orderNumber`, so running
 * it twice is harmless.
 *
 *   node --experimental-strip-types scripts/migrate-orders.ts
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

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is not set.");

const client = new MongoClient(uri);
await client.connect();

const db = client.db();
const orders = db.collection("orders");
const counters = db.collection("counters");

const pending = await orders
  .find({ orderNumber: { $exists: false } })
  .sort({ createdAt: 1 })
  .toArray();

console.log(`Found ${pending.length} order(s) to migrate.`);

let migrated = 0;

for (const order of pending) {
  const year = new Date(order.createdAt ?? Date.now()).getFullYear();

  const counter = await counters.findOneAndUpdate(
    { _id: `orders:${year}` as never },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );

  const seq = counter?.seq ?? 1;
  const orderNumber = `RMK-${year}-${String(seq).padStart(6, "0")}`;
  const status = order.status ?? "received";

  await orders.updateOne(
    { _id: order._id },
    {
      $set: {
        orderNumber,
        stockReleased: status === "cancelled",
        statusHistory: [
          {
            from: null,
            to: status,
            at: order.updatedAt ?? order.createdAt ?? new Date(),
            actor: "admin",
            stockEffect: status === "cancelled" ? "released" : "reserved",
            note: "Backfilled during migration — original history unavailable.",
          },
        ],
      },
    },
  );

  migrated++;
  if (migrated % 25 === 0) console.log(`  …${migrated}/${pending.length}`);
}

console.log(`Migrated ${migrated} order(s).`);

// Ensure the new indexes exist so the unique constraint on orderNumber is
// enforced from here on.
await orders.createIndex({ orderNumber: 1 }, { unique: true, sparse: true });
await orders.createIndex({ buyerEmail: 1, createdAt: -1 });
console.log("Indexes ensured.");

await client.close();
