import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

/**
 * Real-user performance samples, collected from visitors' browsers.
 *
 * This is the storage behind the admin's Performance tab. Every page view
 * emits a handful of Core Web Vitals; the browser beacons them to
 * `/api/metrics/vitals`, which validates and writes them here, and the
 * owner-only query API aggregates them into p75s.
 *
 * Three deliberate design choices:
 *
 * 1. **This collection expires, and that is correct.** Unlike the audit
 *    log — where a TTL would destroy the only record of who did what —
 *    these are disposable measurements. Nobody needs the LCP of one page
 *    view from four months ago, and keeping them would quietly eat the
 *    Atlas quota that real orders live in. `RETENTION_DAYS` is enforced by
 *    a TTL index, so pruning happens without a cron job.
 *
 * 2. **Nothing here identifies a person.** No IP, no user-agent string, no
 *    session or customer id, no raw URL. The route is stored as a
 *    *pattern* (`/product/[id]`, never `/product/68f2...?ref=...`) and the
 *    device is narrowed to `mobile | desktop` before it is written. That
 *    keeps an endpoint the whole internet can POST to from becoming a
 *    place personal data accumulates, and it means this collection needs
 *    no special handling if it is ever exported or shared.
 *
 * 3. **Route cardinality is bounded by an allowlist, not by trust.** The
 *    collector is unauthenticated, so `route` is attacker-controlled. If
 *    it were stored as sent, anyone could write a million distinct route
 *    values and make both the index and the per-route breakdown useless.
 *    `normalizeRoute` maps anything unrecognised to `other`, so the set of
 *    possible values is fixed by this file.
 */

/**
 * The metrics worth storing.
 *
 * FID is deliberately absent: it was replaced by INP as a Core Web Vital
 * and modern browsers report both, so collecting it would double the
 * write volume for a number nobody acts on.
 */
export const WEB_VITAL_NAMES = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];

export type WebVitalRating = "good" | "needs-improvement" | "poor";
export type WebVitalDevice = "mobile" | "desktop";

/**
 * Good/poor boundaries from web.dev. Values are milliseconds except CLS,
 * which is a unitless layout-shift score.
 *
 * The rating a browser sends is not trusted — it is recomputed here from
 * the value, so a forged `rating: "good"` cannot skew the dashboard.
 */
export const WEB_VITAL_THRESHOLDS: Record<
  WebVitalName,
  { good: number; poor: number; unit: "ms" | "score" }
> = {
  LCP: { good: 2500, poor: 4000, unit: "ms" },
  INP: { good: 200, poor: 500, unit: "ms" },
  CLS: { good: 0.1, poor: 0.25, unit: "score" },
  FCP: { good: 1800, poor: 3000, unit: "ms" },
  TTFB: { good: 800, poor: 1800, unit: "ms" },
};

/**
 * Upper bound per metric, past which a sample is discarded rather than
 * stored.
 *
 * These are not "good" thresholds — they are absurdity limits. A real LCP
 * of 10 minutes does not happen; a forged one would drag the p75 of every
 * chart on the page. Clamping instead of rejecting would be worse, because
 * a clamped value still counts as a genuine slow page view.
 */
const MAX_PLAUSIBLE_VALUE: Record<WebVitalName, number> = {
  LCP: 120_000,
  INP: 120_000,
  CLS: 100,
  FCP: 120_000,
  TTFB: 120_000,
};

/** How long samples live before MongoDB removes them. */
export const RETENTION_DAYS = 30;

export interface WebVitalDoc {
  _id: ObjectId;
  at: Date;
  name: WebVitalName;
  /** Milliseconds, except CLS which is a unitless score. */
  value: number;
  /** Recomputed server-side from `value` — never taken from the client. */
  rating: WebVitalRating;
  /** A route *pattern* from `ROUTE_PATTERNS`, or `other`. */
  route: string;
  navigationType?: string;
  device: WebVitalDevice;
}

/**
 * Every route the storefront can report, most specific first.
 *
 * Admin routes are absent on purpose. They sit behind a login, they are
 * used by a handful of people on office connections, and their numbers
 * would drag the storefront p75 — which is the one that costs sales — in a
 * direction nobody can act on. The client reporter skips them too; this is
 * the second half of that same decision.
 */
const ROUTE_PATTERNS: { pattern: string; test: RegExp }[] = [
  { pattern: "/", test: /^\/$/ },
  { pattern: "/cart", test: /^\/cart\/?$/ },
  { pattern: "/product/[id]", test: /^\/product\/[^/]+\/?$/ },
];

export const KNOWN_ROUTES = [...ROUTE_PATTERNS.map((r) => r.pattern), "other"];

/**
 * Maps a pathname to one of a fixed set of patterns.
 *
 * Anything unrecognised — a route added later, a typo, or a deliberately
 * junk value from a forged beacon — collapses to `other` rather than
 * widening the set of stored values. Seeing `other` climb is the signal
 * that a new pattern belongs in the list above.
 */
export function normalizeRoute(pathname: unknown): string {
  if (typeof pathname !== "string" || pathname.length > 512) return "other";

  // Strip query and hash before matching: `/cart?added=1` is the same
  // route as `/cart`, and the query string is exactly where identifiers
  // and referrers tend to hide.
  const path = pathname.split(/[?#]/)[0];

  for (const { pattern, test } of ROUTE_PATTERNS) {
    if (test.test(path)) return pattern;
  }
  return "other";
}

/** Derives the rating a value earns, independent of what was reported. */
export function rateValue(name: WebVitalName, value: number): WebVitalRating {
  const { good, poor } = WEB_VITAL_THRESHOLDS[name];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

export function isWebVitalName(value: unknown): value is WebVitalName {
  return (
    typeof value === "string" &&
    (WEB_VITAL_NAMES as readonly string[]).includes(value)
  );
}

/**
 * Whether a reported number is worth storing.
 *
 * Rejects non-finite values (a JSON `null`, or an `Infinity` that survived
 * a hand-rolled serializer), negatives, and anything past the absurdity
 * limit for that metric.
 */
export function isPlausibleValue(name: WebVitalName, value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_PLAUSIBLE_VALUE[name]
  );
}

/**
 * Narrows a user-agent to `mobile` or `desktop` and keeps nothing else.
 *
 * Read on the server so the client never has to send a UA string we would
 * then have to decide whether to store. A coarse split is all the
 * dashboard needs — mobile and desktop have genuinely different
 * performance profiles, and anything finer is fingerprinting surface for
 * no added insight.
 */
export function deviceFromUserAgent(userAgent: string | null): WebVitalDevice {
  if (!userAgent) return "desktop";
  return /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(userAgent)
    ? "mobile"
    : "desktop";
}

let indexesEnsured = false;

export async function getWebVitalsCollection() {
  const db = await getDb();
  const collection = db.collection<WebVitalDoc>("webVitals");

  if (!indexesEnsured) {
    indexesEnsured = true;
    await Promise.all([
      // TTL. `expireAfterSeconds` is measured from the `at` value itself,
      // so a sample is removed once it is RETENTION_DAYS old regardless of
      // when it was inserted.
      collection.createIndex(
        { at: 1 },
        { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 },
      ),
      // Serves the headline query: one metric across a time window.
      collection.createIndex({ name: 1, at: -1 }),
      // Serves the per-route breakdown.
      collection.createIndex({ route: 1, name: 1, at: -1 }),
    ]).catch((err) =>
      console.error("Failed to ensure webVitals indexes:", err),
    );
  }

  return collection;
}
