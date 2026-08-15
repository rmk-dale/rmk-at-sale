# Scaling rmk-at-sale on Atlas M0: an operations budget

**Question asked:** can we optimise the MongoDB connection further so more people can use the site at once?

**Short answer:** the connection layer is already close to right, and tuning it further buys almost nothing. The ceiling you are actually hitting is **operations per second**, not connections — and the biggest single consumer of that budget is the checkout path, which spends roughly **14 database round trips per order**, four of them on the very gate that exists to protect the database. Cutting that to ~6 roughly doubles how many people can check out at the same time, on the same free cluster, with no infrastructure change.

Everything below follows from that reframing.

---

## 1. The constraint, stated precisely

Atlas M0 is not limited the way a self-hosted MongoDB is. From the current service limits:

| Limit | M0 value | Where you stand |
|---|---|---|
| Max connections | 500 | Nowhere near it. `maxPoolSize: 5` × containers. |
| **Throughput** | **~100 operations/sec** | **This is the wall.** |
| Sort in memory | 32 MB | Fine — catalogue is small. |
| Data transfer | 10 GB in / 10 GB out per rolling 7 days | Worth watching; see §5.4. |
| Query utilisation | must stay <100% over any 5-min window | Fine — reads are cached. |
| Transactions | supported | You use them; they are not free (see §3.2). |

The behaviour when you exceed 100 ops/sec matters: Atlas **throttles the network and imposes a 1-second cooldown**, then drains a queue before accepting new work. It does not return a clean error you can retry cheaply — it stalls everyone, including the checkouts already in flight. So the failure mode under a lunchtime rush is not "connection refused", it is *every* shopper's request getting slower together, then the 30s `LEASE_TTL_MS` starting to fire and leases leaking.

This is why raising `maxPoolSize` is the wrong instinct. A bigger pool does not raise the 100 ops/sec ceiling; it just lets you push more work into Atlas's queue before it pushes back. **On a throttled tier, pool size is a rate limiter you actually want.**

### Assumptions

- Deployed on Vercel (the comments throughout the codebase say so), so each concurrent request may be served by a separate container with its own `MongoClient` and pool.
- Internal RGOC store: tens of concurrent users at peak, not thousands. Everyone behind one corporate NAT.
- Catalogue is small enough to hold in memory (already assumed by `getPublicProductById`).
- Staying on M0 for now.

---

## 2. Where the operations actually go

### 2.1 Reads: already close to optimal — leave them alone

The read path is genuinely well built, and it is worth being explicit that this is *not* where the problem is:

```
shopper → CDN (s-maxage=15, stale-while-revalidate=60)
            ↓ miss
          ISR rendered page (revalidate = 15)
            ↓ miss
          per-container TTLCache (15s, request-collapsing)
            ↓ miss
          Atlas: one find() on products
```

Four layers, and the `TTLCache` dedupes concurrent misses so ten simultaneous shoppers on a cold container produce **one** query, not ten. With ten warm containers, the whole storefront costs roughly `10 containers ÷ 15s ≈ 0.7 ops/sec`. That is under 1% of the budget.

> **Do not add Redis in front of the catalogue.** It is a tempting "shared cache beats N per-container caches" move, but the numbers say the per-container caches already cost you well under one operation per second. You would be adding a network hop and an invalidation path to reclaim 0.7 ops/sec out of 100.

### 2.2 Checkout: the whole problem, counted

Tracing `app/api/checkout/route.ts` for a 3-item cart:

| # | Operation | Where | Cost |
|---|---|---|---|
| 1 | `ensureGateDoc` upsert | `checkoutGate.ts` | 1 |
| 2 | prune stale leases (`$pull`) | `checkoutGate.ts` | 1 |
| 3 | acquire lease (`findOneAndUpdate`) | `checkoutGate.ts` | 1 |
| 4 | daily-cap `find` | in txn | 1 |
| 5 | `findOne` product × 3 | in txn | 3 |
| 6 | `updateOne` decrement × 3 | in txn | 3 |
| 7 | `nextOrderNumber` `findOneAndUpdate` | in txn | 1 |
| 8 | `orders.insertOne` | in txn | 1 |
| 9 | commit | in txn | 1 |
| 10 | `releaseCheckoutSlot` | `checkoutGate.ts` | 1 |
| | **Total** | | **14** |

At 100 ops/sec that is a hard ceiling of about **7 checkouts per second** if checkout were the only traffic — and the gate admits 15 concurrent, so the gate is sized *above* what the cluster can absorb. Worse, three of those 14 hit **one single document**, which is the next problem.

### 2.3 Two hot documents that serialise everything

**`checkoutGate/gate`.** Every checkout does three writes to the same `_id: "gate"` document (upsert, prune, push) plus one on release. MongoDB takes a document-level write lock, so 15 concurrent checkouts do not run 15-wide here — they queue single file on one document, four times each. The load-shedding valve has become a lock convoy, and it is spending 4 of your ~100 ops/sec per order to do it.

**`counters/orders:2026`.** Every checkout increments the same counter document *inside a transaction*. Two concurrent transactions touching the same document produce a `WriteConflict`; `withTransaction` handles this by retrying — but it retries **the entire transaction**, re-running all six operations. So conflicts do not cost you one operation, they cost you a whole checkout's worth, and the probability of conflict rises with exactly the concurrency you are trying to support. This is the classic hot-counter anti-pattern, and it is the thing most likely to make checkout visibly fall over first.

### 2.4 `/api/metrics/vitals`: quiet but constant

Unauthenticated, `force-dynamic`, and it writes to the same cluster orders live in. Rate limited at 60/min **per IP** — but the entire office shares one NAT'd IP, so that is 60/min *for the whole company*, i.e. ~1 op/sec of continuous write traffic competing with orders, and simultaneously **too low to be correct**: with 30 people browsing, honest beacons get silently dropped once you pass one page view per second company-wide. The limit is both a cost you are paying and a measurement you are losing.

---

## 3. Recommended changes, ranked by ops saved

### 3.1 Move the checkout gate to Redis — saves 4 ops/checkout, removes a lock convoy

You already run Upstash, it is already a hard dependency of every auth path, and a concurrency semaphore is exactly its job. The gate's own comment says "only Mongo sees every request" — that was true before Redis existed in this codebase; it isn't now.

The same sliding-window Lua approach in `rateLimit.ts` adapts directly. A semaphore with lease expiry:

```lua
-- KEYS[1] = semaphore key, ARGV = now, ttlMs, max, member
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1] - ARGV[2])  -- prune expired leases
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[2] * 2)
return 1
```

Release is a single `ZREM`. Prune, count, and admit stay atomic in one round trip, exactly as they are today — you keep every correctness property of the current gate and lose the Atlas cost entirely.

**Trade-offs.**
- *Failure mode changes.* Mongo down currently means checkout fails anyway, so the gate failing with it is invisible. Redis down now blocks checkout too. Given `rateLimit.ts` already fails closed in production on Redis loss — checkout is *already* gated on Redis via `checkoutPerSession` — this adds no new dependency, only more surface on one you have.
- *The lease TTL becomes Redis's problem*, which it is better at (`PEXPIRE` vs. a manual `$pull` scan).
- *One less thing in Mongo to reason about* — you can drop the `checkoutGate` collection.

**Also raise the limit while you're there.** `MAX_CONCURRENT_CHECKOUTS = 15` was sized as "conservative to protect M0", but 15 concurrent × 14 ops each is ~210 ops in flight against a 100/sec cluster — the gate is admitting more than the cluster can take. After the changes in §3.2 (≈6 ops each), 15 concurrent is ~90 ops, which is a sane fit. **Keep it at 15, but now it means something.** Before these changes it should honestly be ~8.

### 3.2 Batch the per-item work — saves 2N−2 ops (4 ops on a 3-item cart)

Currently each cart line costs a `findOne` then an `updateOne`, sequentially, inside the transaction. Transaction duration is what drives write conflicts, so this is doubly expensive: it burns operations *and* it holds the transaction open longer, making 3.3 worse.

Read all products in one query, then decrement all of them in one `bulkWrite`:

```ts
// One read for every line in the cart.
const ids = items.map((i) => i.id);
const docs = await products
  .find({ _id: { $in: ids } }, { session: mongoSession })
  .toArray();
const byId = new Map(docs.map((d) => [d._id, d]));

// ... existing per-item validation + price resolution runs against `byId`,
// unchanged, with no further round trips ...

// One write for every line in the cart. Each filter carries its own stock
// guard, so a shortfall on any line fails that line's update rather than
// silently going negative.
const ops = items.map(({ id, quantity }) => {
  const { variantIndex } = resolved.get(id)!;
  return variantIndex >= 0
    ? {
        updateOne: {
          filter: {
            _id: id,
            [`variants.${variantIndex}.stock`]: { $gte: quantity },
          },
          update: {
            $inc: { [`variants.${variantIndex}.stock`]: -quantity },
            $set: { updatedAt: new Date() },
          },
        },
      }
    : {
        updateOne: {
          filter: { _id: id, stock: { $gte: quantity } },
          update: { $inc: { stock: -quantity }, $set: { updatedAt: new Date() } },
        },
      };
});

const result = await products.bulkWrite(ops, {
  session: mongoSession,
  ordered: false,
});

// If any line didn't match, its stock guard failed. Abort the whole thing.
if (result.modifiedCount !== ops.length) {
  throw new InsufficientStockError(/* identify from the read above */);
}
```

**Trade-offs.**
- *Error messages get slightly less precise.* Today you know exactly which item was short and by how much, because you read it immediately before. With `bulkWrite` you know the count didn't match and have to attribute it from the earlier read — which can be stale by microseconds. Practical fix: report the shortfall from the `find` (which will be right in essentially every case) and fall back to a generic "an item in your cart just sold out" if the read said it was fine. Slight fidelity loss for a 2× reduction in transaction length.
- *The `$gte` guard in the filter is now load-bearing*, not just belt-and-braces. That is fine — it is strictly stronger than the read-then-write it replaces, because the guard is evaluated at write time.

### 3.3 Get the order-number counter out of the transaction — removes the retry amplifier

This is the highest-value change per line of code, and the one with the most interesting trade-off.

The current design increments `counters/orders:2026` inside the transaction specifically so a rolled-back order leaves no gap in the sequence. The cost of that guarantee is that **every concurrent checkout contends on one document, and every conflict re-runs the entire transaction.**

Three options:

| Option | Ops | Gaps? | Notes |
|---|---|---|---|
| **A.** Keep as-is | 1 | No | Conflict amplification scales with concurrency. Status quo. |
| **B.** Allocate before the transaction | 1 | Yes, on failure | Conflicts now cost one retried `findOneAndUpdate`, not a whole transaction. |
| **C.** `INCR` in Redis | 0 Mongo | Yes, on failure | Free, no contention. Sequence lives outside your system of record. |

**Recommend B.** It is the smallest change, it keeps the sequence in Mongo where it belongs, and gaps are cheap to live with: `orderNumber` has a unique sparse index, `statusHistory` records every transition, and the audit log covers the rest — a gap is cosmetically odd, not evidentially dangerous. Weigh that against the current failure mode, where a rush causes transaction retries that make the rush worse.

If you want the gap problem to actually disappear rather than be tolerated, the real answer is to stop treating the display reference as a dense sequence at all — but that is a bigger conversation than this document.

### 3.4 Sample web vitals client-side — recovers ~1 op/sec and fixes a measurement bug

Two changes, independent of each other:

1. **Sample at the client.** Send beacons from ~20% of page views (`Math.random() < 0.2` in the reporter). p75s over hundreds of samples do not meaningfully change; the write volume drops 5×.
2. **Fix the rate limit key.** `vitalsPerIp: 60/min` is wrong for a single-NAT office — it throttles the company, not an abuser. Key it on a per-tab random id (generated in the reporter, held in memory, never stored) with a much lower per-key limit, and keep a *generous* per-IP ceiling as the flood backstop, exactly as `RATE_LIMITS` already does for `otpRequestPerIp` vs `otpRequestPerEmail`. The comment block in `rateLimit.ts` already articulates this principle for the auth endpoints — vitals just didn't get the same treatment.

---

## 4. What to change in `lib/mongodb.ts` — and what not to

The pool config is close to right. Three real findings:

### 4.1 The DNS override runs in production, and shouldn't

```ts
dns.setServers(["8.8.8.8", "1.1.1.1"]);
```

This is a module-level, **process-global** override. It was added to fix `querySrv ECONNREFUSED` on a Windows dev machine, but it currently applies on Vercel too — where it forces *every* DNS lookup in the process through Google and Cloudflare, including nodemailer's SMTP connection and the Upstash REST calls on every rate-limited request. That adds a resolver hop to your hot path and makes an external DNS provider a dependency of checkout.

It is also **unnecessary in production**, because your `MONGODB_URI` is the explicit seedlist form (`mongodb://host1,host2,host3/...?replicaSet=...`), which does no SRV lookup at all. Gate it:

```ts
if (process.env.NODE_ENV === "development") {
  try {
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
  } catch {}
}
```

### 4.2 The seedlist URI pins node hostnames

`ac-e6twnts-shard-00-00.m3zgats.mongodb.net` and friends are hard-coded in the connection string. The whole point of `mongodb+srv://` is that Atlas can replace, resize, or re-provision nodes and the driver re-discovers them. With a pinned seedlist, a node replacement — which Atlas does without asking — takes the app down until someone edits an environment variable.

Use `mongodb+srv://` for the production `MONGODB_URI` and keep the seedlist form only in local `.env.local`, where the DNS workaround lives. Same fix, same file, opposite environments.

### 4.3 Pool options: one change, and reasons not to make the others

```ts
const clientOptions = {
  maxPoolSize: 5,          // KEEP. See below.
  minPoolSize: 0,          // KEEP on Vercel. See below.
  maxIdleTimeMS: 30_000,   // CHANGE from 10_000.
  serverSelectionTimeoutMS: 5_000,
  socketTimeoutMS: 20_000,
  compressors: ["zstd"],   // ADD.
  monitorCommands,
};
```

- **`maxPoolSize: 5` — keep.** The instinct is to raise it "so more users fit". On a 100 ops/sec cluster that is backwards: the pool is the only thing stopping you from queueing work at Atlas faster than Atlas will drain it, and hitting the queue triggers the 1-second cooldown that stalls everybody. Five per container is a reasonable rate limiter. Revisit only after you leave M0.
- **`minPoolSize: 0` — keep.** Raising it to 1 would save a TLS + SCRAM handshake (~100–300 ms) on the first query after a container warms, which is tempting. But Vercel *freezes* containers rather than killing them, and a frozen container's connections stay counted against the 500 cap until the server times them out. `minPoolSize: 0` plus a short idle timeout is a deliberate defence against that, and the comment in the file says as much. It is the right call.
- **`maxIdleTimeMS: 10_000 → 30_000`.** This is the one adjustment worth making. Ten seconds is aggressive enough that a container serving a steady trickle of traffic — one request every 15 seconds, which is exactly the storefront's ISR cadence — reconnects almost every time, paying the handshake repeatedly. Thirty seconds keeps the stale-connection protection (you are at ~2% of the 500-connection cap even with 50 containers holding one connection each) while cutting handshake churn substantially. If you ever see connection counts climbing in the Atlas metrics, put it back.
- **`compressors: ["zstd"]` — add.** Free win, and it protects a limit you haven't thought about: **10 GB outbound per rolling 7 days**. Every cold `getPublicProducts` pulls the entire products collection over the wire, and product documents carry variant arrays and image paths. Compression typically cuts that 3–5×.
- **`readPreference` — don't bother yet.** Routing the vitals aggregations to a secondary is a genuinely good idea on a paid tier. On M0 the throughput cap applies to the cluster, so you would be moving work around inside the same budget. File it under §6.

---

## 5. Expected result

Per checkout, 3-item cart:

| | Today | After §3.1–3.3 |
|---|---|---|
| Gate (acquire + release) | 4 | **0** (Redis) |
| Daily-order cap | 1 | 1 |
| Product reads | 3 | **1** |
| Stock decrements | 3 | **1** |
| Order number | 1 (in txn) | 1 (outside txn) |
| Order insert | 1 | 1 |
| Commit | 1 | 1 |
| **Total** | **14** | **6** |

Roughly **2.3× more checkouts per second on the same cluster**, and — more importantly — the two single-document hotspots that cause retry storms under concurrency are gone. The transaction shrinks from ~9 operations to ~4, which cuts conflict probability by more than the operation count alone suggests, because conflict windows scale with transaction duration.

Read traffic is unchanged, because it was never the problem.

---

## 6. What to revisit as this grows

- **The line where M10 becomes cheaper than engineering.** At ~6 ops per checkout and 100 ops/sec, the cluster tops out around 15 checkouts/sec — far beyond an internal store. If this ever opens to real customers, stop optimising and upgrade; every change past this point trades clarity for headroom you can buy.
- **`getPublicProducts` does a full unindexed collection scan.** Correct today (small catalogue, heavily cached). If the catalogue passes a few thousand items, the seam to change is the one the code comment already identifies in `getPublicProductById`.
- **Per-container caches multiply with container count.** At 50+ warm containers the 0.7 ops/sec in §2.1 becomes ~3.5, and a shared Redis cache starts to pay for itself. Not before.
- **The daily-order cap query** is the one read still inside the transaction. It is index-covered (`buyerEmail: 1, createdAt: -1`) and bounded by `limit`, so it is cheap — but if the transaction ever needs to shrink further, this is the next candidate to move outside it.
- **`ALLOWED_EMAIL_DOMAINS` disappearing** would turn the loose per-IP rate limits into a genuine exposure. The reasoning in `rateLimit.ts` is explicit that the limits are safe *because* of the allowlist. Any change to ordering eligibility must revisit that table.

---

## Sources

- [Atlas Free Cluster Limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) — M0 throughput (100 ops/sec), connection cap (500), data transfer, throttling behaviour
- [Limits on Atlas Cluster Types](https://www.mongodb.com/docs/atlas/reference/limitations/)
- [Atlas Service Limits](https://www.mongodb.com/docs/atlas/reference/atlas-limits/)
