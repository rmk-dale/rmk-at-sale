/**
 * Behavioural checks for lib/cache.ts.  Run with `npm run check:cache`.
 *
 * The TTL cache is small but it sits in front of every storefront read, and
 * its failure modes are all silent — a stale entry doesn't throw, it just
 * quietly serves the wrong price. These assert the four properties the rest
 * of the app relies on: request collapsing, TTL expiry, invalidation
 * beating an in-flight load, and failures never being cached.
 *
 * No database and no network: the "loader" is a plain async function, which
 * is the whole point — the cache's contract is independent of Mongo.
 */
import { createTTLCache } from "../lib/cache.ts";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------

console.log("\ncollapses concurrent misses into a single load");
{
  let calls = 0;
  const cache = createTTLCache<number>(1_000);
  const loader = async () => {
    calls++;
    await sleep(20);
    return 42;
  };

  const results = await Promise.all(
    Array.from({ length: 10 }, () => cache.get(loader)),
  );
  check("ten concurrent readers cause one DB call", calls === 1);
  check("every reader receives the value", results.every((r) => r === 42));
}

console.log("\nserves warm reads without touching the loader");
{
  let calls = 0;
  const cache = createTTLCache<number>(1_000);
  const loader = async () => {
    calls++;
    return 1;
  };

  await cache.get(loader);
  await cache.get(loader);
  await cache.get(loader);
  check("loader ran exactly once", calls === 1);
  check("cache reports itself warm", cache.peek().cached === true);
}

console.log("\nreloads once the TTL lapses");
{
  let calls = 0;
  const cache = createTTLCache<number>(30);
  const loader = async () => {
    calls++;
    return calls;
  };

  await cache.get(loader);
  await sleep(50);
  const value = await cache.get(loader);
  check("loader ran a second time", calls === 2);
  check("the fresh value is returned", value === 2);
}

console.log("\ninvalidation beats a load already in flight");
{
  // The regression this guards: a read starts, an admin saves mid-flight,
  // and the read lands afterwards carrying pre-write data. Without the
  // generation counter that stale data is stored with a *fresh* TTL, so the
  // save appears to do nothing for a full window.
  const cache = createTTLCache<string>(10_000);
  let state = "before-write";

  // Snapshot at the start of the load, the way a real query does: it sees
  // the collection as of when it was issued, not when it resolves.
  const slowLoader = async () => {
    const snapshot = state;
    await sleep(50);
    return snapshot;
  };

  const inFlight = cache.get(slowLoader);
  await sleep(10);
  state = "after-write";
  cache.invalidate();

  check("the in-flight caller still gets a result", (await inFlight) === "before-write");
  check(
    "the next read sees the write, not the stale value",
    (await cache.get(async () => state)) === "after-write",
  );
}

console.log("\nnever caches a failure");
{
  let calls = 0;
  const cache = createTTLCache<number>(10_000);
  const failing = async () => {
    calls++;
    throw new Error("atlas unavailable");
  };

  let threw = false;
  try {
    await cache.get(failing);
  } catch {
    threw = true;
  }

  check("the rejection reaches the caller", threw);
  check("nothing was stored", cache.peek().cached === false);
  check("a later read recovers", (await cache.get(async () => 7)) === 7);
  check("the failing loader ran once, not per waiter", calls === 1);
}

console.log("\nrejects every waiter when a shared load fails");
{
  const cache = createTTLCache<number>(10_000);
  const failing = async () => {
    await sleep(10);
    throw new Error("boom");
  };

  const outcomes = await Promise.allSettled([
    cache.get(failing),
    cache.get(failing),
    cache.get(failing),
  ]);
  check("all waiters reject", outcomes.every((o) => o.status === "rejected"));
  check("the cache is left empty", cache.peek().cached === false);
}

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
