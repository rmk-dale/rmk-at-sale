"use client";

import { useReportWebVitals } from "next/web-vitals";

/**
 * Reports Core Web Vitals from the visitor's browser to /api/metrics/vitals.
 *
 * Mounted once in the root layout. It renders nothing — its only job is to
 * confine the `"use client"` boundary to this file, so adding performance
 * monitoring doesn't turn the layout (and everything under it) into a
 * client component.
 *
 * The measurements themselves are free: the browser is already collecting
 * them through the Performance API whether or not anyone reads them. What
 * costs something is *reporting* them, so this file is mostly about making
 * that as close to free as possible:
 *
 *   - **One request per page, not one per metric.** Samples are buffered
 *     and flushed together, so a page view costs a single beacon rather
 *     than five separate POSTs competing with the images and fetches the
 *     visitor actually came for.
 *   - **Sent when the page is being left, not while it is in use.** The
 *     flush is triggered by the page becoming hidden, which is also the
 *     last moment the numbers can still change (LCP and CLS are only final
 *     once the visitor stops looking).
 *   - **`sendBeacon`, so leaving the page doesn't cancel it.** A normal
 *     `fetch` issued during unload is routinely killed mid-flight, which
 *     silently loses precisely the slow page views most worth seeing.
 */

/** Where the samples go. */
const ENDPOINT = "/api/metrics/vitals";

/**
 * Fraction of page loads that report, from
 * `NEXT_PUBLIC_VITALS_SAMPLE_RATE`.
 *
 * Defaults to a quarter of page views, down from all of them.
 *
 * This endpoint is the only unauthenticated write path in the app, and it
 * writes to the same Atlas cluster orders live in — a cluster throttled at
 * roughly 100 operations per second, where every beacon competes with a
 * checkout. Reporting every page view spent that budget continuously to
 * measure a storefront used by one company.
 *
 * Percentiles survive sampling well, because they describe a distribution
 * rather than a total: a p75 drawn from a random quarter of page views is
 * very close to the p75 of all of them, and the Performance tab reads in
 * p75s. Raise it if a chart ever looks too sparse to act on; the write
 * cost scales linearly with it.
 *
 * The decision is made once here, at module scope, rather than per metric.
 * Sampling each metric independently would produce page views reporting
 * LCP but not CLS, which quietly makes the per-route sample counts
 * disagree with each other for no reason.
 */
const SAMPLE_RATE = (() => {
  const parsed = Number(process.env.NEXT_PUBLIC_VITALS_SAMPLE_RATE ?? "0.25");
  if (!Number.isFinite(parsed)) return 0.25;
  return Math.min(1, Math.max(0, parsed));
})();

/**
 * A random id for this tab, sent with each beacon so the collector can
 * rate-limit per client instead of per IP.
 *
 * The whole company shares one NAT'd address, so a per-IP limit throttles
 * everybody at once — it cannot tell twelve colleagues browsing from one
 * person misbehaving. This can, at least for honest clients; the collector
 * keeps a much looser per-IP ceiling as the flood backstop.
 *
 * Deliberately not persisted. It lives in module scope for the life of the
 * page and is gone on reload, so it identifies a tab for a few minutes and
 * never becomes something that tracks a person across visits. That keeps
 * the promise the collector makes about storing nothing identifying — the
 * id is used for a rate-limit key and is never written to the database.
 */
const CLIENT_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * Whether this particular page load reports at all.
 *
 * Development is excluded because localhost numbers are meaningless as a
 * measure of production — an unminified dev build with hot reloading
 * attached would drag every chart down while telling you nothing about
 * what visitors experience.
 */
const ENABLED =
  process.env.NODE_ENV === "production" && Math.random() < SAMPLE_RATE;

interface BufferedMetric {
  name: string;
  value: number;
  navigationType?: string;
  /**
   * Captured when the metric is recorded, not when it is sent.
   *
   * These are separate moments: a visitor can land on a product page,
   * navigate to the cart, and only then close the tab. The LCP belongs to
   * the product page, and reading `location.pathname` at flush time would
   * file it under the cart instead — attributing slowness to the wrong
   * page, which is worse than not measuring it.
   */
  path: string;
}

let buffer: BufferedMetric[] = [];
let listenersAttached = false;

/**
 * Sends everything buffered so far and empties the buffer.
 *
 * Grouped by path because the collector stores one route per request, and
 * a single page view can produce metrics for more than one path after a
 * client-side navigation.
 */
function flush() {
  if (buffer.length === 0) return;

  const pending = buffer;
  // Cleared before sending, not after. If the page is hidden, restored,
  // and hidden again, this must not send the same samples twice and
  // double-count them.
  buffer = [];

  const byPath = new Map<string, BufferedMetric[]>();
  for (const metric of pending) {
    const group = byPath.get(metric.path);
    if (group) group.push(metric);
    else byPath.set(metric.path, [metric]);
  }

  for (const [path, metrics] of byPath) {
    const body = JSON.stringify({
      route: path,
      cid: CLIENT_ID,
      metrics: metrics.map(({ name, value, navigationType }) => ({
        name,
        value,
        navigationType,
      })),
    });

    try {
      if (navigator.sendBeacon) {
        // text/plain keeps this a CORS-simple request, so the browser
        // sends it without a preflight — an OPTIONS round trip during
        // unload is exactly the kind of thing that gets dropped.
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }));
      } else {
        // `keepalive` is the fetch equivalent: it lets the request outlive
        // the document. Errors are swallowed because there is nothing
        // sensible to do about a failed measurement, and an unhandled
        // rejection in a visitor's console is a real bug in a way a lost
        // sample is not.
        void fetch(ENDPOINT, {
          method: "POST",
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Never let telemetry break the page it is measuring.
    }
  }
}

/**
 * Flushes when the page is hidden — closing the tab, switching tabs, or
 * backgrounding the app on mobile.
 *
 * `visibilitychange` is used in preference to `beforeunload`, which is
 * unreliable on mobile Safari and blocks the back-forward cache. `pagehide`
 * is a belt-and-braces second trigger for older WebKit, where
 * `visibilitychange` can be missed on navigation; the buffer is emptied on
 * the first flush, so a double fire sends nothing the second time.
 */
function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

/**
 * Buffers one metric.
 *
 * Defined at module scope rather than inside the component because
 * `useReportWebVitals` replays every metric collected so far to any new
 * callback it is given — so a callback whose identity changed between
 * renders would record the same samples repeatedly.
 */
function handleMetric(metric: {
  name: string;
  value: number;
  navigationType?: string;
}) {
  if (!ENABLED) return;

  const path = window.location.pathname;

  // The admin panel is measured by nobody's standard: it sits behind a
  // login, it is used by a handful of people, and mixing its numbers into
  // the storefront p75 would move the one metric that actually tracks lost
  // sales for reasons that have nothing to do with customers.
  if (path.startsWith("/admin")) return;

  // A cap on the buffer, in case something pathological (a long-lived tab
  // with hundreds of client-side navigations) accumulates far more than a
  // page view's worth before the first flush.
  if (buffer.length >= 64) return;

  attachListeners();
  buffer.push({
    name: metric.name,
    value: metric.value,
    navigationType: metric.navigationType,
    path,
  });
}

export default function WebVitals() {
  useReportWebVitals(handleMetric);
  return null;
}
