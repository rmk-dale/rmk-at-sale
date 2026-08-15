import crypto from "crypto";
// Relative + explicit .ts, matching lib/rateLimit.ts, so this module stays
// importable from the `scripts/` self-tests that run under
// `node --experimental-strip-types`. See the note there.
import {
  IS_PRODUCTION,
  UPSTASH_CONFIGURED,
  upstashCommand,
} from "./upstash.ts";

/**
 * A concurrency gate for checkout, backed by Upstash Redis.
 *
 * ## Why this moved off MongoDB
 *
 * This gate used to live in a single MongoDB document (`checkoutGate/gate`),
 * on the reasoning that only Mongo sees requests from every Vercel
 * container. That was true when it was written, but it made the valve
 * expensive in exactly the currency it was meant to protect:
 *
 *   - **Four Atlas operations per checkout** — an upsert to ensure the
 *     document existed, a `$pull` to prune stale leases, a
 *     `findOneAndUpdate` to acquire, and a `$pull` to release. Atlas M0 is
 *     throttled at roughly 100 operations/sec, so the gate alone consumed
 *     about a third of the budget of the checkout it was guarding.
 *   - **A lock convoy on one document.** All four writes targeted the same
 *     `_id`, and MongoDB takes a document-level write lock. Fifteen
 *     concurrent checkouts did not run fifteen-wide; they queued single
 *     file, four times each, precisely when concurrency was highest.
 *
 * Redis has no such problem, the app already depends on it for rate
 * limiting on every authenticated path (including checkout's own
 * `checkoutPerSession` limit), and lease expiry is a native primitive
 * (`PEXPIRE`) rather than a hand-rolled `$pull` scan.
 *
 * ## What it still is
 *
 * A load-shedding valve, not a correctness mechanism. Stock correctness is
 * guaranteed by the conditional `$gte` stock guards and the transaction in
 * the checkout route, regardless of whether this gate exists or is even
 * reachable. Its only job is to stop a spike of simultaneous checkouts
 * from piling onto a shared, throttled Atlas cluster together and slowing
 * every in-flight checkout down at once.
 */

/**
 * How many checkouts may run at once.
 *
 * This number is only meaningful in relation to what a checkout costs.
 * After the batching work in `app/api/checkout/route.ts`, one checkout is
 * roughly six Atlas operations, so fifteen concurrent checkouts is about
 * 90 operations in flight against a ~100 ops/sec cluster — a deliberate
 * fit rather than a guess.
 *
 * If you change the per-checkout operation count, revisit this. If you
 * upgrade off the free tier, raise it via `CHECKOUT_MAX_CONCURRENT`.
 */
export const MAX_CONCURRENT_CHECKOUTS = Number(
  process.env.CHECKOUT_MAX_CONCURRENT ?? 15,
);

/**
 * Safety net: if a function crashes or is killed mid-checkout without
 * reaching the `finally` that releases its lease, the lease would
 * otherwise sit in the set forever, permanently shrinking capacity. Any
 * lease older than this is treated as abandoned. Well above a normal
 * checkout's duration, and comfortably above the route's own
 * `socketTimeoutMS`.
 */
export const LEASE_TTL_MS = 30_000;

/** One key holds the whole semaphore; there is only ever one gate. */
const GATE_KEY = "gate:checkout";

/**
 * Sorted-set semaphore.
 *
 * Member = an opaque lease id, score = the millisecond it was acquired.
 * Expired leases are trimmed, the survivors counted, and the new lease
 * recorded only if there is room — all inside one Lua invocation, so the
 * check and the write cannot interleave with another container's. This is
 * the same shape as the sliding-window limiter in `lib/rateLimit.ts`; the
 * difference is that entries here are removed on release rather than
 * ageing out, so the set tracks *in-flight work* rather than past attempts.
 *
 * `PEXPIRE` on the key itself is belt-and-braces: if every holder somehow
 * vanished, the key disappears on its own rather than lingering.
 *
 * Exported so scripts/check-gate.ts can exercise it against an isolated
 * key. That script is the only way this Lua is ever verified — it never
 * runs in development, where the in-process fallback below takes over.
 */
export const ACQUIRE_LUA = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local ttl    = tonumber(ARGV[2])
local max    = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - ttl)

if redis.call('ZCARD', key) >= max then
  return 0
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, ttl * 2)
return 1
`;

// ---------------------------------------------------------------------------
// Development fallback: same semantics, per-process only.
// ---------------------------------------------------------------------------

const localLeases = new Map<string, number>();

function localAcquire(leaseId: string): boolean {
  const cutoff = Date.now() - LEASE_TTL_MS;
  for (const [id, at] of localLeases) {
    if (at <= cutoff) localLeases.delete(id);
  }
  if (localLeases.size >= MAX_CONCURRENT_CHECKOUTS) return false;
  localLeases.set(leaseId, Date.now());
  return true;
}

/**
 * Tries to reserve a checkout slot. Returns a lease id to pass to
 * `releaseCheckoutSlot` on success, or `null` if the gate is at capacity.
 *
 * When Redis is unreachable this **fails closed** in production, matching
 * `lib/rateLimit.ts`. Admitting unmetered checkouts during a Redis outage
 * is how a throttled Atlas cluster gets buried, and checkout already
 * cannot complete without Redis anyway — `checkoutPerSession` is checked a
 * few lines earlier in the route and fails closed itself. Failing here is
 * therefore not a new dependency, only an earlier and cheaper refusal.
 */
export async function acquireCheckoutSlot(): Promise<string | null> {
  const leaseId = crypto.randomBytes(12).toString("hex");

  if (!UPSTASH_CONFIGURED) {
    if (IS_PRODUCTION) return null;
    return localAcquire(leaseId) ? leaseId : null;
  }

  try {
    const admitted = Number(
      await upstashCommand([
        "EVAL",
        ACQUIRE_LUA,
        "1",
        GATE_KEY,
        String(Date.now()),
        String(LEASE_TTL_MS),
        String(MAX_CONCURRENT_CHECKOUTS),
        leaseId,
      ]),
    );

    return admitted === 1 ? leaseId : null;
  } catch (error) {
    console.error("[checkoutGate] Upstash unavailable:", error);
    // No retry. A checkout that cannot even reserve a slot should be told
    // to come back in a moment, not made to wait out a second round trip
    // to a Redis that is already failing.
    if (IS_PRODUCTION) return null;
    return localAcquire(leaseId) ? leaseId : null;
  }
}

/**
 * Releases a slot acquired via `acquireCheckoutSlot`. Always call this,
 * success or failure, once the checkout attempt is done.
 *
 * Failure is logged and swallowed: the order has already been committed
 * (or already failed) by this point, and the lease expires on its own
 * after `LEASE_TTL_MS` regardless. Throwing here would turn a successful
 * checkout into a 500.
 */
export async function releaseCheckoutSlot(leaseId: string): Promise<void> {
  if (!UPSTASH_CONFIGURED) {
    localLeases.delete(leaseId);
    return;
  }

  try {
    await upstashCommand(["ZREM", GATE_KEY, leaseId]);
  } catch (error) {
    console.error("[checkoutGate] Failed to release checkout slot:", error);
  }
}

/** In-flight checkout count, for diagnostics. Returns null if unavailable. */
export async function peekCheckoutGate(): Promise<number | null> {
  if (!UPSTASH_CONFIGURED) return localLeases.size;
  try {
    return Number(await upstashCommand(["ZCARD", GATE_KEY]));
  } catch {
    return null;
  }
}
