"use client";

import { useEffect, useState } from "react";
import TrafficPanel from "./TrafficPanel";

/**
 * The Performance tab.
 *
 * Shows p75 Core Web Vitals collected from real visitors, which is the
 * number that matters rather than the average: a mean is dragged down by
 * the fast page views and hides the slow tail, while the 75th percentile
 * is a promise that three in four people had at least this experience. It
 * is also the statistic Google's own tooling reports, so these figures are
 * directly comparable to PageSpeed Insights instead of being a private
 * scale that only means something here.
 *
 * The chart is hand-drawn SVG rather than a charting library. One
 * sparkline does not justify shipping a dependency to every admin page
 * load, on a screen whose entire subject is page weight.
 */

type MetricName = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
type Rating = "good" | "needs-improvement" | "poor";

interface MetricSummary {
  name: MetricName;
  count: number;
  p75: number | null;
  rating: Rating | null;
  good: number;
  needsImprovement: number;
  poor: number;
  threshold: { good: number; poor: number; unit: "ms" | "score" };
}

interface RouteSummary {
  route: string;
  count: number;
  metrics: Partial<
    Record<MetricName, { p75: number; rating: Rating; count: number }>
  >;
}

interface VitalsResponse {
  rangeDays: number;
  retentionDays: number;
  totalSamples: number;
  truncated: boolean;
  metrics: MetricSummary[];
  routes: RouteSummary[];
  series: ({ day: string } & Partial<Record<MetricName, number>>)[];
}

const RANGES = [
  { label: "24 hours", value: 1 },
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
];

const DEVICES = [
  { label: "All devices", value: "" },
  { label: "Mobile", value: "mobile" },
  { label: "Desktop", value: "desktop" },
];

/** What each metric actually measures, in the terms the reader cares about. */
const METRIC_BLURBS: Record<MetricName, string> = {
  LCP: "How long until the main content appears",
  INP: "How quickly the page responds to a tap or click",
  CLS: "How much the layout jumps around while loading",
  FCP: "How long until anything is drawn at all",
  TTFB: "How long the server takes to start responding",
};

const RATING_STYLES: Record<Rating, { text: string; bg: string; dot: string }> =
  {
    good: {
      text: "text-emerald-700",
      bg: "bg-emerald-50 border-emerald-200",
      dot: "bg-emerald-500",
    },
    "needs-improvement": {
      text: "text-amber-700",
      bg: "bg-amber-50 border-amber-200",
      dot: "bg-amber-500",
    },
    poor: {
      text: "text-rose-700",
      bg: "bg-rose-50 border-rose-200",
      dot: "bg-rose-500",
    },
  };

const RATING_LABELS: Record<Rating, string> = {
  good: "Good",
  "needs-improvement": "Needs work",
  poor: "Poor",
};

/**
 * Formats a value in the unit its metric is measured in.
 *
 * Seconds past the 1s mark, because "3.4 s" is read at a glance where
 * "3402 ms" has to be converted first — and this screen is scanned, not
 * studied. CLS is unitless and small, so it keeps three decimals.
 */
function formatValue(value: number | null, unit: "ms" | "score"): string {
  if (value === null) return "—";
  if (unit === "score") return value.toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

/** Proportional bar showing the good / needs-work / poor split. */
function RatingBar({ metric }: { metric: MetricSummary }) {
  const total = metric.good + metric.needsImprovement + metric.poor;
  if (total === 0) return null;

  const pct = (n: number) => `${(n / total) * 100}%`;

  return (
    <div className="mt-3">
      <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-100">
        <div
          className="bg-emerald-500"
          style={{ width: pct(metric.good) }}
          title={`${metric.good} good`}
        />
        <div
          className="bg-amber-500"
          style={{ width: pct(metric.needsImprovement) }}
          title={`${metric.needsImprovement} need work`}
        />
        <div
          className="bg-rose-500"
          style={{ width: pct(metric.poor) }}
          title={`${metric.poor} poor`}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-zinc-400">
        {Math.round((metric.good / total) * 100)}% good ·{" "}
        {metric.count.toLocaleString()} sample
        {metric.count === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/**
 * Daily p75 trend for one metric.
 *
 * The y-axis is deliberately anchored at zero rather than fitted to the
 * data range. An auto-fitted axis turns a 40 ms wobble into a dramatic
 * cliff, which is how a chart lies without any of its numbers being wrong.
 */
function Sparkline({
  points,
  unit,
  good,
}: {
  points: { day: string; value: number }[];
  unit: "ms" | "score";
  good: number;
}) {
  if (points.length < 2) {
    return (
      <div className="h-32 flex items-center justify-center text-sm text-zinc-400">
        Not enough days of data to draw a trend yet.
      </div>
    );
  }

  const width = 720;
  const height = 128;
  const padY = 12;

  const max = Math.max(...points.map((p) => p.value), good * 1.2);
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => height - padY - (v / max) * (height - padY * 2);

  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-32"
      preserveAspectRatio="none"
      role="img"
      aria-label="Daily trend"
    >
      {/* The "good" threshold, so the line is read against the target
          rather than against itself. */}
      <line
        x1="0"
        x2={width}
        y1={y(good)}
        y2={y(good)}
        stroke="currentColor"
        className="text-emerald-300"
        strokeWidth="1"
        strokeDasharray="4 4"
      />
      <polygon points={area} className="fill-zinc-900/5" />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        className="text-zinc-900"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {points.map((p, i) => (
        <circle key={p.day} cx={x(i)} cy={y(p.value)} r="2.5" className="fill-zinc-900">
          <title>{`${p.day}: ${formatValue(p.value, unit)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export default function PerformanceView() {
  const [data, setData] = useState<VitalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [device, setDevice] = useState("");
  const [focus, setFocus] = useState<MetricName>("LCP");

  useEffect(() => {
    // Same guard as the activity log: clicking quickly between ranges can
    // resolve an older request after a newer one and leave the screen
    // showing numbers that don't match the selected filters.
    let cancelled = false;

    const params = new URLSearchParams({ days: String(days) });
    if (device) params.set("device", device);

    fetch(`/api/admin/metrics/vitals?${params.toString()}`)
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled) return;
        setData(payload && Array.isArray(payload.metrics) ? payload : null);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [days, device]);

  const focused = data?.metrics.find((m) => m.name === focus);
  const seriesPoints =
    data?.series
      .map((row) => ({ day: row.day, value: row[focus] }))
      .filter((p): p is { day: string; value: number } =>
        typeof p.value === "number",
      ) ?? [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">Performance</h1>
        <p className="text-sm text-zinc-500 mt-1">
          How the storefront actually loads for real visitors, measured in
          their browsers. Figures are 75th percentile — three in four page
          views were at least this fast. Visible to owners only.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => setDays(r.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              days === r.value
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {r.label}
          </button>
        ))}

        <span className="w-px h-5 bg-border mx-1" />

        {/* Scoped to page speed only, and labelled so, since Vercel's
            traffic figures below use their own device categories. */}
        <span className="text-xs text-zinc-400">Page speed:</span>

        {DEVICES.map((d) => (
          <button
            key={d.label}
            onClick={() => setDevice(d.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              device === d.value
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {d.label}
          </button>
        ))}

        {!loading && data && (
          <span className="ml-auto self-center text-xs text-zinc-500">
            {data.totalSamples.toLocaleString()} speed sample
            {data.totalSamples === 1 ? "" : "s"}
            {data.truncated && " (capped)"}
          </span>
        )}
      </div>

      {/* Traffic comes from Vercel and page speed from our own database, so
          they fail independently — one can be empty or misconfigured while
          the other is fine. Rendered outside the vitals branch below for
          exactly that reason. The device filter is not passed down: Vercel
          splits devices into its own categories, and silently applying our
          two-way mobile/desktop split to their data would produce a number
          that looks filtered but isn't. */}
      <TrafficPanel days={days} />

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading page speed data…</p>
      ) : !data || data.totalSamples === 0 ? (
        <div className="text-center py-24 bg-surface rounded-2xl border border-border">
          <p className="text-zinc-500">No speed measurements yet.</p>
          <p className="text-zinc-400 text-sm mt-1 max-w-md mx-auto">
            Samples are collected from real visitors on the live site, so
            nothing appears until the next deploy is up and someone browses
            it. Local development is deliberately excluded.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
            <h2 className="text-sm font-medium text-zinc-900">Page speed</h2>
            <span className="text-xs text-zinc-400">
              75th percentile · select a metric to chart it
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
            {data.metrics.map((metric) => {
              const style = metric.rating
                ? RATING_STYLES[metric.rating]
                : null;
              const selected = focus === metric.name;

              return (
                <button
                  key={metric.name}
                  onClick={() => setFocus(metric.name)}
                  className={`text-left p-4 rounded-2xl border transition-colors ${
                    selected
                      ? "border-zinc-900 bg-surface"
                      : "border-border bg-surface hover:border-zinc-300"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {style && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${style.dot}`}
                      />
                    )}
                    <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      {metric.name}
                    </span>
                  </div>

                  <p
                    className={`mt-2 text-2xl font-semibold tabular-nums ${
                      style ? style.text : "text-zinc-300"
                    }`}
                  >
                    {formatValue(metric.p75, metric.threshold.unit)}
                  </p>

                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    {metric.rating
                      ? RATING_LABELS[metric.rating]
                      : metric.name === "INP"
                        ? "No interactions yet"
                        : "No data"}
                    {metric.p75 !== null && (
                      <>
                        {" · target "}
                        {formatValue(
                          metric.threshold.good,
                          metric.threshold.unit,
                        )}
                      </>
                    )}
                  </p>

                  <p className="text-[11px] text-zinc-400 mt-1.5 leading-snug">
                    {METRIC_BLURBS[metric.name]}
                  </p>

                  <RatingBar metric={metric} />
                </button>
              );
            })}
          </div>

          {focused && (
            <div className="bg-surface border border-border rounded-2xl p-5 mb-8">
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="text-sm font-medium text-zinc-900">
                  {focused.name} over time
                </h2>
                <span className="text-xs text-zinc-400">
                  daily p75 · dashed line is the &ldquo;good&rdquo; target ·
                  UTC days
                </span>
              </div>
              <Sparkline
                points={seriesPoints}
                unit={focused.threshold.unit}
                good={focused.threshold.good}
              />
            </div>
          )}

          <div className="border border-border rounded-2xl overflow-hidden bg-surface">
            <div className="px-5 py-3 border-b border-border">
              <h2 className="text-sm font-medium text-zinc-900">By page</h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Slowest first. Pages are grouped by pattern, so every product
                page counts toward one row.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 border-b border-border">
                    <th className="px-5 py-2.5 font-medium">Page</th>
                    {(["LCP", "INP", "CLS", "FCP", "TTFB"] as MetricName[]).map(
                      (name) => (
                        <th
                          key={name}
                          className="px-3 py-2.5 font-medium text-right"
                        >
                          {name}
                        </th>
                      ),
                    )}
                    <th className="px-5 py-2.5 font-medium text-right">
                      Samples
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.routes.map((row) => (
                    <tr key={row.route}>
                      <td className="px-5 py-3 font-mono text-xs text-zinc-900">
                        {row.route}
                      </td>
                      {(
                        ["LCP", "INP", "CLS", "FCP", "TTFB"] as MetricName[]
                      ).map((name) => {
                        const cell = row.metrics[name];
                        const unit =
                          data.metrics.find((m) => m.name === name)?.threshold
                            .unit ?? "ms";
                        return (
                          <td
                            key={name}
                            className={`px-3 py-3 text-right tabular-nums ${
                              cell
                                ? RATING_STYLES[cell.rating].text
                                : "text-zinc-300"
                            }`}
                          >
                            {cell ? formatValue(cell.p75, unit) : "—"}
                          </td>
                        );
                      })}
                      <td className="px-5 py-3 text-right text-zinc-500 tabular-nums">
                        {row.count.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-zinc-400 mt-4">
            Samples are kept for {data.retentionDays} days and then removed
            automatically. Nothing identifying a visitor is stored — no IP, no
            user agent, no URLs beyond the page patterns above.
          </p>
        </>
      )}
    </div>
  );
}
