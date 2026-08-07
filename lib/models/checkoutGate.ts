import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

/**
 * A concurrency gate for checkout, backed by a single document in Mongo.
 *
 * Vercel can run many containers at once, so an in-memory counter can't
 * cap total concurrency across them — only Mongo sees every request. This
 * trades one extra round trip per checkout for protection against a spike
 * of simultaneous checkouts overwhelming a shared, throttled Atlas free
 * cluster: once MAX_CONCURRENT_CHECKOUTS are in flight, new requests are
 * turned away with a "try again in a moment" response instead of piling
 * onto Atlas and slowing down every in-flight checkout together.
 *
 * This is a load-shedding valve, not a correctness mechanism — stock
 * correctness is already guaranteed by the atomic $gte stock check and
 * transaction in the checkout route regardless of whether this gate exists.
 */

interface CheckoutLease {
  id: ObjectId;
  acquiredAt: Date;
}

interface CheckoutGateDoc {
  _id: "gate";
  leases: CheckoutLease[];
}

const GATE_ID = "gate";

// How many checkouts may run at once. Conservative on purpose: Atlas M0 is
// shared/throttled, not dedicated, so this protects it rather than trying
// to saturate it. Tune via env var if you outgrow it (e.g. after upgrading
// off the free tier) without a code change.
const MAX_CONCURRENT_CHECKOUTS = Number(
  process.env.CHECKOUT_MAX_CONCURRENT ?? 15,
);

// Safety net: if a function crashes or is killed mid-checkout (rare, but
// possible on serverless) without reaching the `finally` release, its lease
// would otherwise sit in the array forever, permanently shrinking capacity.
// Any lease older than this is treated as abandoned and pruned on the next
// acquire attempt. Well above a normal checkout's duration.
const LEASE_TTL_MS = 30_000;

async function getGateCollection() {
  const db = await getDb();
  return db.collection<CheckoutGateDoc>("checkoutGate");
}

/** Ensures the singleton gate document exists. Safe to call repeatedly. */
async function ensureGateDoc() {
  const gate = await getGateCollection();
  await gate.updateOne(
    { _id: GATE_ID },
    { $setOnInsert: { leases: [] } },
    { upsert: true },
  );
  return gate;
}

/**
 * Tries to reserve a checkout slot. Returns a lease id to pass to
 * `releaseCheckoutSlot` on success, or `null` if the gate is at capacity.
 */
export async function acquireCheckoutSlot(): Promise<ObjectId | null> {
  const gate = await ensureGateDoc();

  // Prune abandoned leases first so a past crash doesn't permanently eat
  // capacity.
  const staleBefore = new Date(Date.now() - LEASE_TTL_MS);
  await gate.updateOne(
    { _id: GATE_ID },
    { $pull: { leases: { acquiredAt: { $lt: staleBefore } } } },
  );

  const leaseId = new ObjectId();
  const result = await gate.findOneAndUpdate(
    {
      _id: GATE_ID,
      $expr: { $lt: [{ $size: "$leases" }, MAX_CONCURRENT_CHECKOUTS] },
    },
    { $push: { leases: { id: leaseId, acquiredAt: new Date() } } },
  );

  return result ? leaseId : null;
}

/** Releases a slot acquired via `acquireCheckoutSlot`. Always call this,
 * success or failure, once the checkout attempt is done. */
export async function releaseCheckoutSlot(leaseId: ObjectId): Promise<void> {
  const gate = await getGateCollection();
  await gate
    .updateOne({ _id: GATE_ID }, { $pull: { leases: { id: leaseId } } })
    .catch((err) =>
      console.error("Failed to release checkout slot:", err),
    );
}
