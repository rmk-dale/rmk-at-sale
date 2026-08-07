/**
 * Tiny in-memory TTL cache for per-container read caching on Vercel.
 *
 * Each warm serverless container gets its own copy of this cache (module
 * state isn't shared across containers), so this isn't a substitute for a
 * shared cache like Redis — but for data that's read far more often than
 * it's written (product/brand listings), it cuts out most of the redundant
 * Atlas round trips per container without adding any infrastructure.
 *
 * Three properties make it safe to rely on:
 *
 *   1. **Concurrent misses are deduped.** If ten requests hit an expired or
 *      empty cache at the same moment, only one DB call goes out and the
 *      rest await it, instead of ten queries landing on Atlas at once.
 *
 *   2. **Invalidation beats an in-flight load.** See `generation` below.
 *
 *   3. **Failures are never cached.** A rejected loader leaves the previous
 *      value in place (already expired, so the next caller retries) and the
 *      rejection propagates to everyone currently awaiting it. A transient
 *      Atlas blip therefore can't poison the cache with an error or an
 *      empty list for a full TTL.
 */

export interface TTLCache<T> {
  /** Returns the cached value, loading it via `loader` on a miss. */
  get(loader: () => Promise<T>): Promise<T>;
  /** Drops the cached value and disowns any load already in flight. */
  invalidate(): void;
  /** Current state, for diagnostics. */
  peek(): { cached: boolean; ageMs: number | null };
}

export function createTTLCache<T>(ttlMs: number): TTLCache<T> {
  let value: T | undefined;
  let hasValue = false;
  let storedAt = 0;
  let expiresAt = 0;
  let pending: Promise<T> | null = null;

  /**
   * Guards against a stale write racing an invalidation.
   *
   * Without it, this interleaving silently serves stale data for a full
   * TTL — which is worse than not caching at all, because it happens
   * precisely when someone has just saved a change and is looking for it:
   *
   *   1. A read misses and starts loading the product list.
   *   2. An admin saves a price change; `invalidate()` clears the cache.
   *   3. The load from step 1 resolves with the *pre-edit* list and stores
   *      it with a fresh 15s expiry.
   *
   * The counter is bumped on every invalidation. A loader captures its
   * value before starting and only commits its result if the counter still
   * matches — otherwise the data it fetched predates a write it doesn't
   * know about, so it is returned to that one caller and thrown away
   * rather than cached.
   */
  let generation = 0;

  return {
    async get(loader: () => Promise<T>): Promise<T> {
      if (hasValue && expiresAt > Date.now()) return value as T;
      if (pending) return pending;

      const loadedAtGeneration = generation;

      pending = loader()
        .then((result) => {
          // Discard the write if an invalidation landed mid-flight; the
          // result is still handed back to the callers awaiting it, since
          // it's no more stale than a response that started a moment
          // earlier. It just doesn't become the new cached value.
          if (loadedAtGeneration === generation) {
            value = result;
            hasValue = true;
            storedAt = Date.now();
            expiresAt = storedAt + ttlMs;
          }
          return result;
        })
        .finally(() => {
          pending = null;
        });

      return pending;
    },

    invalidate() {
      generation++;
      value = undefined;
      hasValue = false;
      storedAt = 0;
      expiresAt = 0;
    },

    peek() {
      return {
        cached: hasValue && expiresAt > Date.now(),
        ageMs: hasValue ? Date.now() - storedAt : null,
      };
    },
  };
}
