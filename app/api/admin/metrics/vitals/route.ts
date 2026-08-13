import { NextRequest, NextResponse } from "next/server";
import type { Filter } from "mongodb";
import { requireOwner } from "@/lib/adminGuard";
import {
  KNOWN_ROUTES,
  RETENTION_DAYS,
  WEB_VITAL_NAMES,
  WEB_VITAL_THRESHOLDS,
  getWebVitalsCollection,
  rateValue,
  type WebVitalDevice,
  type WebVitalDoc,
  type WebVitalName,
} from "@/lib/models/webVital";

/**
 * Aggregated web-vitals for the admin Performance tab.
 *
 * Owner-only, matching /api/admin/audit. The data is not sensitive in the
 * way the audit log is — nobody is held to account by an LCP number — but
 * it describes infrastructure and traffic shape, and the tab that renders
 * it is already gated to owners. Two different answers to "who can see
 * this" between the page and its API is how a guard quietly stops meaning
 * anything.
 *
 * Everything is computed in a single aggregation. The obvious alternative
 * — one query per metric per route — is thirty round trips to Atlas to
 * draw one screen, on a cluster sized for orders.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Selectable windows. Anything else is rejected rather than clamped. */
const ALLOWED_DAYS = [1, 7, 30] as const;
const DEFAULT_DAYS = 7;

/**
 * Ceiling on how many samples one request will aggregate.
 *
 * p75 is computed by sorting the values in memory, so without a bound a
 * busy month could build an array large enough to fail the aggregation
 * outright — the failure mode being that the dashboard breaks exactly when
 * the site is busiest and you most want to look at it.
 *
 * The limit is applied to the *most recent* samples, so when it does bite
 * the answer degrades to "p75 over the latest 50,000 measurements in this
 * window" rather than over all of them. That is a perfectly serviceable
 * number, and `truncated` in the response says plainly when it happened.
 */
const MAX_SAMPLES = 50_000;

/**
 * Nearest-rank 75th percentile of an array field, as an aggregation
 * expression.
 *
 * Written out by hand rather than using the `$percentile` accumulator,
 * which needs MongoDB 7.0 — this works on 5.2 and up, so the dashboard
 * doesn't quietly depend on an Atlas version bump.
 *
 * The rank is `ceil(0.75 * N)` and the array index is one less, which is
 * the definition Chrome's CrUX dataset and the web-vitals library use: the
 * smallest value that at least 75% of samples fall at or below. Using
 * `floor` instead is the off-by-one that makes every number here
 * disagree with PageSpeed Insights by one sample position.
 */
function p75Of(valuesField: string) {
  return {
    $let: {
      vars: { sorted: { $sortArray: { input: valuesField, sortBy: 1 } } },
      in: {
        $arrayElemAt: [
          "$$sorted",
          {
            $max: [
              0,
              {
                $min: [
                  { $subtract: [{ $size: "$$sorted" }, 1] },
                  {
                    $subtract: [
                      {
                        $ceil: {
                          $multiply: [0.75, { $size: "$$sorted" }],
                        },
                      },
                      1,
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

/** Counts of each rating, alongside the p75, for one group. */
const RATING_COUNTS = {
  good: { $sum: { $cond: [{ $eq: ["$rating", "good"] }, 1, 0] } },
  needsImprovement: {
    $sum: { $cond: [{ $eq: ["$rating", "needs-improvement"] }, 1, 0] },
  },
  poor: { $sum: { $cond: [{ $eq: ["$rating", "poor"] }, 1, 0] } },
};

interface OverallRow {
  _id: WebVitalName;
  count: number;
  p75: number;
  good: number;
  needsImprovement: number;
  poor: number;
}

interface RouteRow {
  _id: { route: string; name: WebVitalName };
  count: number;
  p75: number;
}

interface SeriesRow {
  _id: { day: Date; name: WebVitalName };
  count: number;
  p75: number;
}

export async function GET(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = req.nextUrl.searchParams;

  const rawDays = Number(params.get("days"));
  const days = (ALLOWED_DAYS as readonly number[]).includes(rawDays)
    ? rawDays
    : DEFAULT_DAYS;

  const filter: Filter<WebVitalDoc> = {};

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  filter.at = { $gte: since };

  // Checked against the same allowlist the collector writes through, so a
  // filter can only ever name a route that could actually exist.
  const route = params.get("route");
  if (route) {
    if (!KNOWN_ROUTES.includes(route)) {
      return NextResponse.json({ error: "Unknown route." }, { status: 400 });
    }
    filter.route = route;
  }

  const device = params.get("device");
  if (device) {
    if (device !== "mobile" && device !== "desktop") {
      return NextResponse.json({ error: "Unknown device." }, { status: 400 });
    }
    filter.device = device as WebVitalDevice;
  }

  const collection = await getWebVitalsCollection();

  const [facets] = await collection
    .aggregate<{
      overall: OverallRow[];
      byRoute: RouteRow[];
      series: SeriesRow[];
      total: { count: number }[];
    }>(
      [
        { $match: filter },
        // Sorted newest-first so the MAX_SAMPLES cap keeps the most recent
        // measurements rather than an arbitrary slice. The TTL index on
        // `at` serves both the range and this sort.
        { $sort: { at: -1 } },
        { $limit: MAX_SAMPLES },
        {
          $facet: {
            total: [{ $count: "count" }],
            overall: [
              {
                $group: {
                  _id: "$name",
                  count: { $sum: 1 },
                  values: { $push: "$value" },
                  ...RATING_COUNTS,
                },
              },
              { $set: { p75: p75Of("$values") } },
              { $unset: "values" },
            ],
            byRoute: [
              {
                $group: {
                  _id: { route: "$route", name: "$name" },
                  count: { $sum: 1 },
                  values: { $push: "$value" },
                },
              },
              { $set: { p75: p75Of("$values") } },
              { $unset: "values" },
            ],
            series: [
              {
                $group: {
                  // UTC day buckets. The alternative — bucketing in the
                  // viewer's timezone — would mean the same sample landing
                  // in different days for different admins, so the chart
                  // is anchored to one clock and labelled as such.
                  _id: {
                    day: { $dateTrunc: { date: "$at", unit: "day" } },
                    name: "$name",
                  },
                  count: { $sum: 1 },
                  values: { $push: "$value" },
                },
              },
              { $set: { p75: p75Of("$values") } },
              { $unset: "values" },
              { $sort: { "_id.day": 1 } },
            ],
          },
        },
      ],
      // The in-memory 100 MB per-stage limit is generous relative to
      // MAX_SAMPLES, but spilling to disk is preferable to an aggregation
      // that throws.
      { allowDiskUse: true },
    )
    .toArray();

  const totalSamples = facets?.total?.[0]?.count ?? 0;

  const overallByName = new Map(
    (facets?.overall ?? []).map((row) => [row._id, row]),
  );

  // Always returns all five metrics, present or not. A metric with no
  // samples is a real state worth rendering — INP only fires once someone
  // interacts, so an empty INP card means "nobody clicked", which is
  // different from "we forgot to measure it" and shouldn't be an absent
  // card the reader has to notice is missing.
  const metrics = WEB_VITAL_NAMES.map((name) => {
    const row = overallByName.get(name);
    const threshold = WEB_VITAL_THRESHOLDS[name];
    if (!row || row.count === 0) {
      return {
        name,
        count: 0,
        p75: null,
        rating: null,
        good: 0,
        needsImprovement: 0,
        poor: 0,
        threshold,
      };
    }
    return {
      name,
      count: row.count,
      p75: row.p75,
      rating: rateValue(name, row.p75),
      good: row.good,
      needsImprovement: row.needsImprovement,
      poor: row.poor,
      threshold,
    };
  });

  // Pivot the per-route rows into one object per route.
  const routeMap = new Map<
    string,
    {
      route: string;
      count: number;
      metrics: Partial<
        Record<WebVitalName, { p75: number; rating: string; count: number }>
      >;
    }
  >();

  for (const row of facets?.byRoute ?? []) {
    const existing = routeMap.get(row._id.route) ?? {
      route: row._id.route,
      count: 0,
      metrics: {},
    };
    existing.count += row.count;
    existing.metrics[row._id.name] = {
      p75: row.p75,
      rating: rateValue(row._id.name, row.p75),
      count: row.count,
    };
    routeMap.set(row._id.route, existing);
  }

  // Worst LCP first: the page most likely to be losing you a sale should
  // not be something the reader has to hunt for. Routes without an LCP
  // sample sort last rather than to the top.
  const routes = [...routeMap.values()].sort(
    (a, b) => (b.metrics.LCP?.p75 ?? -1) - (a.metrics.LCP?.p75 ?? -1),
  );

  const seriesMap = new Map<string, { day: string } & Partial<Record<WebVitalName, number>>>();
  for (const row of facets?.series ?? []) {
    const day = row._id.day.toISOString().slice(0, 10);
    const existing = seriesMap.get(day) ?? { day };
    existing[row._id.name] = row.p75;
    seriesMap.set(day, existing);
  }

  return NextResponse.json({
    rangeDays: days,
    from: since.toISOString(),
    to: new Date().toISOString(),
    retentionDays: RETENTION_DAYS,
    totalSamples,
    /** True when the MAX_SAMPLES cap was hit and older samples were excluded. */
    truncated: totalSamples >= MAX_SAMPLES,
    metrics,
    routes,
    series: [...seriesMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
  });
}
