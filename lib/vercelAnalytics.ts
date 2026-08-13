import { createTTLCache, type TTLCache } from "@/lib/cache";

/**
 * Server-side reader for Vercel Web Analytics.
 *
 * The `<Analytics />` component in the root layout sends page views to
 * Vercel; this module reads the aggregates back out so they can be shown
 * inside the admin instead of on vercel.com. It is the counterpart to
 * lib/models/webVital.ts, and the split is worth stating plainly because
 * the two look similar and are not:
 *
 *   - **Web vitals** (ours) measure how fast pages load. We collect and
 *     store them because Vercel's Speed Insights data cannot be exported
 *     or queried at all.
 *   - **Traffic** (this file) measures how many people visit. Vercel
 *     already collects it, keeps it for a month on Hobby, and — since the
 *     Web Analytics API went public in May 2026 — will hand it back over
 *     HTTP. Duplicating that into Atlas would be work and storage spent
 *     re-deriving something already computed.
 *
 * Everything here runs on the server only. The access token is a
 * team-wide credential — it can do considerably more than read analytics —
 * so it must never be inlined into a client bundle. That is why this
 * module is imported by the route handler and not by the view, and why
 * none of these env vars carry a `NEXT_PUBLIC_` prefix.
 */

const API_BASE = "https://api.vercel.com/v1/query/web-analytics";

/**
 * A Vercel access token with read access to the project. Create one under
 * Account Settings → Tokens.
 */
const TOKEN = process.env.VERCEL_ANALYTICS_TOKEN;

/**
 * The project to query. Vercel exposes `VERCEL_PROJECT_ID` to deployments
 * automatically, so on Vercel this usually needs no configuration; the
 * explicit variable exists so the tab also works when running the
 * production build locally.
 */
const PROJECT_ID =
  process.env.VERCEL_ANALYTICS_PROJECT_ID ?? process.env.VERCEL_PROJECT_ID;

/**
 * Only needed when the project belongs to a team rather than a personal
 * account. Vercel rejects the request if this is sent when it shouldn't
 * be, so it is omitted entirely when unset rather than sent empty.
 */
const TEAM_ID = process.env.VERCEL_ANALYTICS_TEAM_ID;

export const isVercelAnalyticsConfigured = Boolean(TOKEN && PROJECT_ID);

/**
 * How long a set of results is reused before Vercel is asked again.
 *
 * Traffic figures are read by a handful of admins looking at a dashboard,
 * and they describe hours or days of activity — a number five minutes
 * stale is indistinguishable from a fresh one to anyone reading it. The
 * cache exists because without it, every open of the tab is four
 * round-trips to a third-party API sitting in front of the page render,
 * and a rate limit or a slow response there becomes a slow admin panel.
 */
const CACHE_TTL_MS = 5 * 60_000;

/** Give up rather than let a slow upstream hold a serverless function open. */
const REQUEST_TIMEOUT_MS = 8_000;

export interface TrafficRow {
  /** The dimension value: a route, a country, a device type, a hostname. */
  label: string;
  pageviews: number;
  visitors: number;
}

export interface TrafficDay {
  day: string;
  pageviews: number;
  visitors: number;
}

export interface TrafficSummary {
  configured: true;
  rangeDays: number;
  pageviews: number;
  /**
   * Summed across days, so this is visitor-days rather than unique
   * visitors over the whole window. Vercel deduplicates within a day but
   * cannot across days without cross-day identity, which it deliberately
   * doesn't keep. The UI labels it accordingly — quietly presenting this
   * as "unique visitors" would overstate reach by however many people
   * came back.
   */
  visitors: number;
  days: TrafficDay[];
  routes: TrafficRow[];
  referrers: TrafficRow[];
  devices: TrafficRow[];
}

export interface TrafficUnavailable {
  configured: boolean;
  error: string;
}

export type TrafficResult = TrafficSummary | TrafficUnavailable;

interface AggregateResponse {
  data?: unknown;
}

/**
 * One aggregate query, grouped by a single dimension.
 *
 * `by` accepts up to two dimensions, but every panel here wants exactly
 * one, and asking for two would return a cross-product that has to be
 * re-flattened for display.
 */
async function aggregate(
  by: string,
  since: Date,
  until: Date,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    projectId: PROJECT_ID!,
    by,
    since: since.toISOString(),
    until: until.toISOString(),
    limit: String(limit),
  });
  if (TEAM_ID) params.set("teamId", TEAM_ID);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}/visits/aggregate?${params}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: controller.signal,
      // Vercel's own edge cache must not hold this; the TTL cache below is
      // the only caching layer we want, because it's the one we can reason
      // about.
      cache: "no-store",
    });

    if (!res.ok) {
      // The status is worth distinguishing: 401/403 means the token is
      // wrong or lacks access, 402 means the plan's event allowance is
      // exhausted, 410 means analytics isn't enabled for the project.
      // Lumping them together as "failed" would send someone hunting
      // through the wrong settings page.
      throw new Error(`Vercel Analytics API returned ${res.status}`);
    }

    const body = (await res.json()) as AggregateResponse;
    return Array.isArray(body.data)
      ? (body.data as Record<string, unknown>[])
      : [];
  } finally {
    clearTimeout(timeout);
  }
}

/** Coerces a possibly-missing numeric field without turning it into NaN. */
function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Flattens one aggregate response into label/pageviews/visitors rows.
 *
 * The dimension arrives under a key named after the dimension itself
 * (`route`, `country`, `deviceType`…), and Vercel groups everything past
 * `limit` into a row it labels `Others`. Anything missing a usable label
 * is dropped rather than rendered as "undefined" — a blank row in a table
 * reads as a bug even when the data is fine.
 */
export function toRows(
  data: Record<string, unknown>[],
  dimension: string,
): TrafficRow[] {
  return data
    .map((row) => ({
      label:
        typeof row[dimension] === "string" && row[dimension]
          ? (row[dimension] as string)
          : "",
      pageviews: num(row.pageviews),
      visitors: num(row.visitors),
    }))
    .filter((row) => row.label !== "")
    .sort((a, b) => b.pageviews - a.pageviews);
}

/** Flattens the by-day response into a dense, chronological series. */
export function toDays(data: Record<string, unknown>[]): TrafficDay[] {
  return data
    .map((row) => {
      const raw = row.timestamp;
      const date =
        typeof raw === "string" || typeof raw === "number"
          ? new Date(raw)
          : null;
      if (!date || Number.isNaN(date.getTime())) return null;
      return {
        day: date.toISOString().slice(0, 10),
        pageviews: num(row.pageviews),
        visitors: num(row.visitors),
      };
    })
    .filter((row): row is TrafficDay => row !== null)
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * One cache per time range.
 *
 * `createTTLCache` holds a single value, so a shared instance would make
 * the 7-day view serve the 24-hour numbers to whoever asked second. Keying
 * by range keeps each window's dedupe and invalidation behaviour intact.
 */
const caches = new Map<number, TTLCache<TrafficResult>>();

function cacheFor(days: number): TTLCache<TrafficResult> {
  let cache = caches.get(days);
  if (!cache) {
    cache = createTTLCache<TrafficResult>(CACHE_TTL_MS);
    caches.set(days, cache);
  }
  return cache;
}

/**
 * Traffic for the last `days` days, or a description of why it isn't
 * available.
 *
 * Never throws. A missing token, an expired plan allowance, or Vercel
 * having a bad afternoon should degrade this one panel to an explanatory
 * message — the rest of the Performance tab is served from our own
 * database and has no reason to go down with it.
 */
export async function getTraffic(days: number): Promise<TrafficResult> {
  if (!isVercelAnalyticsConfigured) {
    return {
      configured: false,
      error:
        "Set VERCEL_ANALYTICS_TOKEN and VERCEL_ANALYTICS_PROJECT_ID to show traffic here.",
    };
  }

  return cacheFor(days).get(async () => {
    const until = new Date();
    const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);

    try {
      // Issued together rather than in sequence: they are independent, and
      // four sequential 200 ms calls is most of a second of dead time on a
      // page that already waits on Atlas.
      const [dayRows, routeRows, referrerRows, deviceRows] = await Promise.all([
        aggregate("day", since, until, 100),
        aggregate("route", since, until, 10),
        aggregate("referrerHostname", since, until, 8),
        aggregate("deviceType", since, until, 5),
      ]);

      const dayData = toDays(dayRows);

      return {
        configured: true,
        rangeDays: days,
        // Totalled from the daily series rather than fetched separately:
        // one fewer API call, and it guarantees the headline figure agrees
        // with the chart underneath it. Two numbers from two queries that
        // disagree by a rounding edge is the kind of thing that costs an
        // afternoon.
        pageviews: dayData.reduce((sum, d) => sum + d.pageviews, 0),
        visitors: dayData.reduce((sum, d) => sum + d.visitors, 0),
        days: dayData,
        routes: toRows(routeRows, "route"),
        referrers: toRows(referrerRows, "referrerHostname"),
        devices: toRows(deviceRows, "deviceType"),
      } satisfies TrafficSummary;
    } catch (error) {
      console.warn("[vercelAnalytics] Traffic query failed:", error);
      return {
        configured: true,
        error:
          error instanceof Error && error.name === "AbortError"
            ? "Vercel's Analytics API did not respond in time."
            : "Could not read traffic from Vercel. Check the token, the project id, and that Web Analytics is enabled.",
      } satisfies TrafficUnavailable;
    }
  });
}
