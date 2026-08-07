"use client";

import { useEffect, useState } from "react";

interface AuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

interface AuditEntry {
  _id: string;
  at: string;
  adminUsername: string;
  adminRole: "owner" | "staff";
  action: string;
  targetType: "product" | "brand" | "admin" | "order";
  targetId: string;
  targetLabel?: string;
  changes?: AuditChange[];
  ip?: string;
}

const FILTERS: { label: string; value: "" | AuditEntry["targetType"] }[] = [
  { label: "Everything", value: "" },
  { label: "Products", value: "product" },
  { label: "Orders", value: "order" },
  { label: "Brands", value: "brand" },
  { label: "Admins", value: "admin" },
];

const ACTION_LABELS: Record<string, string> = {
  "product.create": "created product",
  "product.update": "edited product",
  "brand.create": "created brand",
  "brand.delete": "deleted brand",
  "admin.invite": "invited admin",
  "admin.update": "updated admin",
  "admin.sessions_revoked": "signed out all sessions for",
  "order.status_change": "changed order status",
};

/** Prices are the reason most people will open this page — make them obvious. */
const HIGH_SIGNAL_FIELDS = new Set(["price", "role", "status", "stock"]);

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export default function AuditLogView() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"" | AuditEntry["targetType"]>("");

  useEffect(() => {
    // `cancelled` guards against out-of-order responses: clicking through
    // filters quickly can resolve an older request after a newer one and
    // leave the list showing something that doesn't match the selection.
    //
    // State is only set from the async callbacks, never synchronously in
    // the effect body — so switching filters keeps the current rows on
    // screen until the new ones arrive rather than flashing a spinner.
    let cancelled = false;

    const params = new URLSearchParams();
    if (filter) params.set("targetType", filter);

    fetch(`/api/admin/audit?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setEntries(Array.isArray(data?.entries) ? data.entries : []);
        setTotal(typeof data?.total === "number" ? data.total : 0);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">Activity log</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Every change made in the admin panel, with who made it. Visible to
          owners only.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f.value
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {f.label}
          </button>
        ))}
        {!loading && (
          <span className="ml-auto self-center text-xs text-zinc-500">
            {total} entr{total === 1 ? "y" : "ies"}
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading activity…</p>
      ) : entries.length === 0 ? (
        <div className="text-center py-24 bg-surface rounded-2xl border border-border">
          <p className="text-zinc-500">No activity recorded yet.</p>
          <p className="text-zinc-400 text-sm mt-1">
            Changes made from here on will appear in this list.
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-2xl overflow-hidden bg-surface divide-y divide-border">
          {entries.map((entry) => (
            <div key={entry._id} className="p-4 flex flex-wrap gap-x-3 gap-y-2">
              <span className="text-xs text-zinc-400 font-mono whitespace-nowrap w-40 shrink-0">
                {new Date(entry.at).toLocaleString()}
              </span>

              <div className="flex-1 min-w-64">
                <p className="text-sm text-zinc-900">
                  <strong className="font-medium">{entry.adminUsername}</strong>
                  {entry.adminRole === "owner" && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-zinc-400">
                      owner
                    </span>
                  )}{" "}
                  <span className="text-zinc-600">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </span>{" "}
                  <span className="font-mono text-xs text-zinc-500">
                    {entry.targetLabel ?? entry.targetId}
                  </span>
                </p>

                {entry.changes && entry.changes.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {entry.changes.map((change, i) => (
                      <li
                        key={i}
                        className={`text-xs ${
                          HIGH_SIGNAL_FIELDS.has(change.field)
                            ? "text-zinc-700"
                            : "text-zinc-500"
                        }`}
                      >
                        <span
                          className={
                            HIGH_SIGNAL_FIELDS.has(change.field)
                              ? "font-medium"
                              : ""
                          }
                        >
                          {change.field}
                        </span>
                        : {renderValue(change.from)}{" "}
                        <span className="text-zinc-400">→</span>{" "}
                        <span className="text-zinc-900">
                          {renderValue(change.to)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {entry.ip && (
                <span className="text-[10px] text-zinc-400 font-mono self-start">
                  {entry.ip}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
