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
 * At current traffic, 1.0 (report everything) gives the tightest numbers
 * and costs little. Turn it down if write volume ever becomes a concern —
 * percentiles survive sampling well, because they describe a distribution
 * rather than a total, and a p75 drawn from a random tenth of page views
 * is very close to the p75 of all of them.
 *
 * The decision is made once here, at module scope, rather than per metric.
 * Sampling each metric independently would produce page views reporting
 * LCP but not CLS, which quietly makes the per-route sample counts
 * disagree with each other for no reason.
 */
const SAMPLE_RATE = (() => {
  const parsed = Number(process.env.NEXT_PUBLIC_VITALS_SAMPLE_RATE ?? "1");
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(1, Math.max(0, parsed));
})();

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
