/**
 * Tiny in-memory TTL cache for per-container read caching on Vercel.
 *
 * Each warm serverless container gets its own copy of this cache (module
 * state isn't shared across containers), so this isn't a substitute for a
 * shared cache like Redis — but for data that's read far more often than
 * it's written (product/brand listings), it cuts out most of the redundant
 * Atlas round trips per container without adding any infrastructure.
 *
 * Concurrent misses are deduped: if ten requests hit an expired/empty cache
 * at the same moment, only one DB call goes out and the rest await it,
 * instead of ten separate queries landing on Atlas at once.
 */
export function createTTLCache<T>(ttlMs: number) {
  let value: T | undefined;
  let expiresAt = 0;
  let pending: Promise<T> | null = null;

  return {
    async get(loader: () => Promise<T>): Promise<T> {
      const now = Date.now();
      if (value !== undefined && expiresAt > now) return value;
      if (pending) return pending;

      pending = loader()
        .then((result) => {
          value = result;
          expiresAt = Date.now() + ttlMs;
          return result;
        })
        .finally(() => {
          pending = null;
        });

      return pending;
    },
    invalidate() {
      value = undefined;
      expiresAt = 0;
    },
  };
}
