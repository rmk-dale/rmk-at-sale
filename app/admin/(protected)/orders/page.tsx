"use client";

import { useCallback, useEffect, useState } from "react";

interface StatusEvent {
  from: OrderStatus | null;
  to: OrderStatus;
  at: string;
  actor: "customer" | "admin";
  adminUsername?: string;
  stockEffect: "released" | "reserved" | "none";
  note?: string;
}

type OrderStatus = "received" | "fulfilled" | "cancelled";

interface AdminOrder {
  _id: string;
  orderNumber?: string;
  buyerEmail: string;
  items: {
    itemCode: string;
    description: string;
    quantity: number;
    price: number;
    color?: string;
    size?: string;
  }[];
  total: number;
  status: OrderStatus;
  stockReleased?: boolean;
  statusHistory?: StatusEvent[];
  createdAt: string;
}

const STATUS_STYLES: Record<OrderStatus, string> = {
  received: "bg-blue-50 text-blue-600",
  fulfilled: "bg-emerald-50 text-emerald-600",
  cancelled: "bg-zinc-100 text-zinc-500",
};

const FILTERS: { label: string; value: "" | OrderStatus }[] = [
  { label: "All", value: "" },
  { label: "Received", value: "received" },
  { label: "Fulfilled", value: "fulfilled" },
  { label: "Cancelled", value: "cancelled" },
];

/**
 * Mirrors ORDER_TRANSITIONS in lib/models/order.ts so the UI only offers
 * moves the API will accept. The server is still the authority — this just
 * avoids showing buttons that are guaranteed to fail.
 */
const ALLOWED_NEXT: Record<OrderStatus, OrderStatus[]> = {
  received: ["fulfilled", "cancelled"],
  fulfilled: ["received", "cancelled"],
  cancelled: ["received"],
};

const ACTION_LABELS: Record<OrderStatus, string> = {
  received: "Reopen",
  fulfilled: "Mark fulfilled",
  cancelled: "Cancel (restock)",
};

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"" | OrderStatus>("");
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter) params.set("status", filter);
    if (search.trim()) params.set("search", search.trim());

    fetch(`/api/admin/orders?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        // The list endpoint is paginated now and returns
        // { orders, total, limit, skip } rather than a bare array.
        setOrders(Array.isArray(data?.orders) ? data.orders : []);
        setTotal(typeof data?.total === "number" ? data.total : 0);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load orders.");
        setLoading(false);
      });
  }, [filter, search]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const stats = {
    total,
    received: orders.filter((o) => o.status === "received").length,
    fulfilled: orders.filter((o) => o.status === "fulfilled").length,
    cancelled: orders.filter((o) => o.status === "cancelled").length,
    revenue: orders.reduce(
      (acc, o) => (o.status !== "cancelled" ? acc + o.total : acc),
      0,
    ),
  };

  const updateStatus = async (orderId: string, status: OrderStatus) => {
    setUpdatingId(orderId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (res.ok) {
        load();
      } else {
        // Surfaces the real reason — an illegal transition, a concurrent
        // edit by another admin, or not enough stock to reopen.
        setError(data?.error ?? "Could not update that order.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">Orders</h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reference or email…"
          className="px-3 py-2 rounded-lg border border-border bg-surface text-sm w-72 outline-none focus:ring-2 focus:ring-zinc-900/10"
        />
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 flex items-center justify-between gap-4">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600"
          >
            Dismiss
          </button>
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-surface border border-border p-4 rounded-2xl">
            <p className="text-xs font-medium text-zinc-500 uppercase mb-1">Total Orders</p>
            <p className="text-2xl font-semibold text-zinc-900">{stats.total}</p>
          </div>
          <div className="bg-surface border border-border p-4 rounded-2xl">
            <p className="text-xs font-medium text-zinc-500 uppercase mb-1">Received</p>
            <p className="text-2xl font-semibold text-blue-600">{stats.received}</p>
          </div>
          <div className="bg-surface border border-border p-4 rounded-2xl">
            <p className="text-xs font-medium text-zinc-500 uppercase mb-1">Fulfilled</p>
            <p className="text-2xl font-semibold text-emerald-600">{stats.fulfilled}</p>
          </div>
          <div className="bg-surface border border-border p-4 rounded-2xl">
            <p className="text-xs font-medium text-zinc-500 uppercase mb-1">Cancelled</p>
            <p className="text-2xl font-semibold text-zinc-500">{stats.cancelled}</p>
          </div>
          <div className="bg-surface border border-border p-4 rounded-2xl">
            <p className="text-xs font-medium text-zinc-500 uppercase mb-1">Revenue</p>
            <p className="text-2xl font-semibold text-zinc-900">₱{stats.revenue.toFixed(2)}</p>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-6">
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
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading orders…</p>
      ) : orders.length === 0 ? (
        <div className="text-center py-24 bg-surface rounded-2xl border border-border">
          <p className="text-zinc-500">No orders found.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <div
              key={order._id}
              className="bg-surface border border-border rounded-2xl p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                <div>
                  <p className="font-mono text-sm text-zinc-900 font-medium">
                    {order.orderNumber ?? `LEGACY-${order._id.slice(-8).toUpperCase()}`}
                  </p>
                  <p className="text-zinc-600 text-sm">{order.buyerEmail}</p>
                  <p className="text-zinc-500 text-xs">
                    {new Date(order.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[order.status]}`}
                  >
                    {order.status}
                  </span>
                  <span className="text-zinc-900 font-semibold">
                    ₱{order.total.toFixed(2)}
                  </span>
                </div>
              </div>

              <ul className="text-sm text-zinc-600 mb-4 space-y-1">
                {order.items.map((item, i) => (
                  <li key={i}>
                    {item.quantity}x {item.description}
                    {(item.color || item.size) && (
                      <span className="text-zinc-500">
                        {" "}
                        ({[item.color, item.size && `Size ${item.size}`]
                          .filter(Boolean)
                          .join(", ")}
                        )
                      </span>
                    )}{" "}
                    <span className="text-zinc-400 font-mono text-xs">
                      ({item.itemCode})
                    </span>{" "}
                    — ₱{(item.price * item.quantity).toFixed(2)}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-2">
                {ALLOWED_NEXT[order.status].map((next) => (
                  <button
                    key={next}
                    disabled={updatingId === order._id}
                    onClick={() => updateStatus(order._id, next)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors ${
                      next === "fulfilled"
                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    }`}
                  >
                    {ACTION_LABELS[next]}
                  </button>
                ))}

                {order.statusHistory && order.statusHistory.length > 0 && (
                  <button
                    onClick={() =>
                      setExpanded(expanded === order._id ? null : order._id)
                    }
                    className="text-xs font-medium px-3 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 ml-auto"
                  >
                    {expanded === order._id ? "Hide history" : "History"}
                  </button>
                )}
              </div>

              {expanded === order._id && order.statusHistory && (
                <ol className="mt-4 pt-4 border-t border-border space-y-2">
                  {order.statusHistory.map((event, i) => (
                    <li key={i} className="text-xs text-zinc-600 flex gap-3">
                      <span className="text-zinc-400 font-mono whitespace-nowrap">
                        {new Date(event.at).toLocaleString()}
                      </span>
                      <span>
                        {event.from ? `${event.from} → ` : ""}
                        <strong className="text-zinc-900">{event.to}</strong>
                        {" · "}
                        {event.actor === "admin"
                          ? (event.adminUsername ?? "admin")
                          : "customer checkout"}
                        {event.stockEffect !== "none" && (
                          <span className="text-zinc-400">
                            {" "}
                            (stock {event.stockEffect})
                          </span>
                        )}
                        {event.note && (
                          <span className="text-zinc-500"> — {event.note}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
