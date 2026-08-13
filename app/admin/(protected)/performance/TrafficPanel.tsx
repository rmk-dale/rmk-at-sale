"use client";

import { useEffect, useState } from "react";

/**
 * Traffic, read back from Vercel Web Analytics.
 *
 * Sits above the web vitals on the same tab because the two answer
 * questions that are only useful together: a 4-second LCP on a page nobody
 * visits is not worth an afternoon, and the same number on the page
 * carrying most of your traffic is worth dropping everything for. Putting
 * them on separate screens makes that judgement harder than it needs to
 * be.
 */

interface TrafficRow {
  label: string;
  pageviews: number;
  visitors: number;
}

interface TrafficDay {
  day: string;
  pageviews: number;
  visitors: number;
}

interface TrafficResponse {
  configured: boolean;
  error?: string;
  pageviews?: number;
  visitors?: number;
  days?: TrafficDay[];
  routes?: TrafficRow[];
  referrers?: TrafficRow[];
  devices?: TrafficRow[];
}

/** Daily page views as bars, with visitors drawn inside them. */
function TrafficChart({ days }: { days: TrafficDay[] }) {
  if (days.length === 0) {
    return (
      <div className="h-28 flex items-center justify-center text-sm text-zinc-400">
        No visits recorded in this period.
      </div>
    );
  }

  const max = Math.max(...days.map((d) => d.pageviews), 1);

  return (
    <div className="flex items-end gap-1 h-28">
      {days.map((day) => (
        <div
          key={day.day}
          className="flex-1 flex flex-col justify-end h-full group relative"
          title={`${day.day}: ${day.pageviews} page views, ${day.visitors} visitors`}
        >
          <div
            className="w-full bg-zinc-200 rounded-t-sm relative"
            style={{ height: `${(day.pageviews / max) * 100}%` }}
          >
            {/* Visitors nested inside page views rather than shown as a
                second bar: it is always the smaller of the two, so the
                inset reads as "of these views, this many were distinct
                people" without needing a legend. */}
            <div
              className="absolute bottom-0 left-0 right-0 bg-zinc-900 rounded-t-sm"
              style={{
                height: `${(day.visitors / Math.max(day.pageviews, 1)) * 100}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Top-N list with a proportional bar behind each row. */
function TopList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: TrafficRow[];
  empty: string;
}) {
  const max = Math.max(...rows.map((r) => r.pageviews), 1);

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-2">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {rows.slice(0, 6).map((row) => (
            <li key={row.label} className="relative">
              <div
                className="absolute inset-y-0 left-0 bg-zinc-100 rounded"
                style={{ width: `${(row.pageviews / max) * 100}%` }}
              />
              <div className="relative flex justify-between gap-3 px-2 py-1 text-sm">
                <span className="truncate text-zinc-700 font-mono text-xs">
                  {row.label}
                </span>
                <span className="text-zinc-500 tabular-nums text-xs shrink-0">
                  {row.pageviews.toLocaleString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TrafficPanel({ days }: { days: number }) {
  const [data, setData] = useState<TrafficResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/admin/metrics/traffic?days=${days}`)
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled) return;
        setData(payload ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [days]);

  if (loading && !data) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-5 mb-8">
        <p className="text-sm text-zinc-500">Loading traffic…</p>
      </div>
    );
  }

  // Not set up, or Vercel wouldn't answer. Both are explained rather than
  // hidden — a panel that silently disappears when misconfigured is how
  // you end up believing you have no visitors.
  if (!data || data.error) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-5 mb-8">
        <h2 className="text-sm font-medium text-zinc-900">Traffic</h2>
        <p className="text-sm text-zinc-500 mt-1">
          {data?.error ?? "Traffic data is unavailable right now."}
        </p>
        {data && !data.configured && (
          <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
            Enable Web Analytics for the project in the Vercel dashboard,
            create an access token under Account Settings → Tokens, then set{" "}
            <code className="font-mono text-zinc-500">
              VERCEL_ANALYTICS_TOKEN
            </code>{" "}
            and{" "}
            <code className="font-mono text-zinc-500">
              VERCEL_ANALYTICS_PROJECT_ID
            </code>{" "}
            in your environment. Add{" "}
            <code className="font-mono text-zinc-500">
              VERCEL_ANALYTICS_TEAM_ID
            </code>{" "}
            only if the project belongs to a team.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-5 mb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <h2 className="text-sm font-medium text-zinc-900">Traffic</h2>
        <span className="text-xs text-zinc-400">
          from Vercel Web Analytics · updates every few minutes
        </span>
      </div>

      <div className="flex flex-wrap gap-8 mb-5">
        <div>
          <p className="text-2xl font-semibold text-zinc-900 tabular-nums">
            {(data.pageviews ?? 0).toLocaleString()}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">Page views</p>
        </div>
        <div>
          <p className="text-2xl font-semibold text-zinc-900 tabular-nums">
            {(data.visitors ?? 0).toLocaleString()}
          </p>
          {/* Named precisely. Vercel counts a visitor once per day, so
              summing across days counts a returning customer more than
              once — calling this "unique visitors" would overstate reach. */}
          <p className="text-xs text-zinc-500 mt-0.5">Visitors (daily sum)</p>
        </div>
      </div>

      <TrafficChart days={data.days ?? []} />

      <p className="text-[11px] text-zinc-400 mt-2 mb-5">
        Bars are page views; the darker inset is visitors.
      </p>

      <div className="grid sm:grid-cols-3 gap-6">
        <TopList
          title="Top pages"
          rows={data.routes ?? []}
          empty="No page data yet."
        />
        <TopList
          title="Referrers"
          rows={data.referrers ?? []}
          empty="No referrers — visitors are arriving directly."
        />
        <TopList
          title="Devices"
          rows={data.devices ?? []}
          empty="No device data yet."
        />
      </div>
    </div>
  );
}
