/**
 * Seconds of shared-cache freshness for storefront data.
 *
 * The storefront pages declare the same window via their own
 * `export const revalidate = 15`. That has to be a literal — Next reads
 * the value by static analysis at build time and rejects an imported
 * constant — so the two cannot be derived from each other. If you change
 * this, change the `revalidate` export in `app/page.tsx` and
 * `app/product/[id]/page.tsx` to match.
 */
export const PUBLIC_READ_MAX_AGE_SECONDS = 15;

/**
 * `Cache-Control` for public, identical-for-everyone JSON reads.
 *
 * Read the directives in order, because each one is load-bearing:
 *
 *   public              Explicitly shareable. Without it, a proxy that sees
 *                       no other signal may decline to store the response
 *                       at all.
 *   s-maxage=15         Freshness for *shared* caches (the CDN) only. This
 *                       is what collapses N visitors into one origin hit
 *                       per window.
 *   max-age=0           Freshness for the *browser*, which is zero on
 *                       purpose. A shopper who reloads should see current
 *                       stock; the CDN, not their disk, is where the
 *                       staleness budget is spent.
 *   stale-while-revalidate=60
 *                       For the minute after an entry goes stale the CDN
 *                       serves the old copy instantly and refreshes in the
 *                       background. This is what stops the TTL expiring
 *                       from turning into a latency spike (or a thundering
 *                       herd) for whoever happens to arrive first.
 *
 * Matched to the storefront pages' ISR window so a shopper can't see a
 * page and its underlying JSON disagree by more than one window.
 *
 * Only for responses with no per-user content. Anything that varies by
 * cookie or session must use `NO_STORE_CACHE_HEADERS` instead — a
 * `public` directive on an authenticated response is how one user's data
 * ends up served to another.
 */
export const PUBLIC_READ_CACHE_HEADERS = {
  "Cache-Control": `public, max-age=0, s-maxage=${PUBLIC_READ_MAX_AGE_SECONDS}, stale-while-revalidate=60`,
} as const;

/**
 * For authenticated or otherwise per-user responses.
 *
 * `private` bars shared caches outright; `no-store` stops even the browser
 * writing it to disk, which matters for admin data on a shared machine.
 */
export const NO_STORE_CACHE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;
