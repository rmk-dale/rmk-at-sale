"use client";

import { useCallback, useEffect, useState } from "react";
import {
  evaluateBundles,
  MAX_QUANTITY_PER_LINE,
  MIN_UNITS_PER_PRODUCT,
} from "@/lib/validation";
import type { ProductDoc } from "@/lib/models/product";

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
    name?: string;
    brand?: string;
    description?: string;
    quantity: number;
    price: number;
    color?: string;
    size?: string;
  }[];
  /**
   * Line total before the bundle rules, and what those rules took off.
   *
   * Both optional: orders placed before the bundle rules shipped carry
   * neither, and `total` was the whole story for them. Never assume they
   * are present — `subtotal ?? total` is the safe read.
   */
  subtotal?: number;
  bundleDiscount?: number;
  total: number;
  status: OrderStatus;
  stockReleased?: boolean;
  statusHistory?: StatusEvent[];
  createdAt: string;
}

/**
 * One row in the "Edit order" draft. Keyed the same way the storefront
 * cart keys a line -- product id + colour + size -- so an existing line
 * and a freshly-added one can never collide.
 */
interface DraftLine {
  key: string;
  itemCode: string;
  name: string;
  brand?: string;
  color?: string;
  size?: string;
  quantity: number;
  price: number;
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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [products, setProducts] = useState<ProductDoc[] | null>(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [addProductId, setAddProductId] = useState("");
  const [addColor, setAddColor] = useState("");
  const [addSize, setAddSize] = useState("");
  const [addQty, setAddQty] = useState(1);
  const [productFilter, setProductFilter] = useState("");

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

  const loadProducts = useCallback(() => {
    if (products || productsLoading) return;
    setProductsLoading(true);
    fetch("/api/admin/products")
      .then((res) => res.json())
      .then((data) => setProducts(Array.isArray(data) ? data : []))
      .catch(() => setProducts([]))
      .finally(() => setProductsLoading(false));
  }, [products, productsLoading]);

  const startEdit = (order: AdminOrder) => {
    setEditingId(order._id);
    setEditError(null);
    setDraftLines(
      order.items.map((item) => ({
        key: `${item.itemCode}|${item.color ?? ""}|${item.size ?? ""}`,
        itemCode: item.itemCode,
        name: item.name || item.description || "Item",
        brand: item.brand,
        color: item.color,
        size: item.size,
        quantity: item.quantity,
        price: item.price,
      })),
    );
    setAddProductId("");
    setAddColor("");
    setAddSize("");
    setAddQty(1);
    setProductFilter("");
    loadProducts();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftLines([]);
    setEditError(null);
  };

  const setLineQuantity = (key: string, quantity: number) => {
    setDraftLines((lines) =>
      quantity <= 0
        ? lines.filter((l) => l.key !== key)
        : lines.map((l) => (l.key === key ? { ...l, quantity } : l)),
    );
  };

  const removeLine = (key: string) => {
    setDraftLines((lines) => lines.filter((l) => l.key !== key));
  };

  const selectedAddProduct = products?.find((p) => p._id === addProductId) ?? null;

  const addProductVariant =
    selectedAddProduct?.variants?.find(
      (v) => (v.color ?? "") === addColor && (v.size ?? "") === addSize,
    ) ?? null;

  const addLine = () => {
    if (!selectedAddProduct) return;
    const hasColors = (selectedAddProduct.colors?.length ?? 0) > 0;
    const hasSizes = (selectedAddProduct.sizes?.length ?? 0) > 0;
    if (hasColors && !addColor) {
      setEditError("Choose a colour for the item you're adding.");
      return;
    }
    if (hasSizes && !addSize) {
      setEditError("Choose a size for the item you're adding.");
      return;
    }
    const hasVariantMatrix = (selectedAddProduct.variants?.length ?? 0) > 0;
    if (hasVariantMatrix && !addProductVariant) {
      setEditError("That colour/size combination isn't available for this item.");
      return;
    }

    const price = addProductVariant ? addProductVariant.price : selectedAddProduct.price;
    const color = addColor || undefined;
    const size = addSize || undefined;
    const key = `${selectedAddProduct._id}|${color ?? ""}|${size ?? ""}`;

    if (draftLines.some((l) => l.key === key)) {
      setEditError("That item is already on this order — change its quantity instead.");
      return;
    }

    setEditError(null);
    setDraftLines((lines) => [
      ...lines,
      {
        key,
        itemCode: selectedAddProduct._id,
        name: selectedAddProduct.name?.trim() || "Item",
        brand: selectedAddProduct.brand,
        color,
        size,
        quantity: Math.max(1, Math.min(addQty, MAX_QUANTITY_PER_LINE)),
        price,
      },
    ]);
    setAddProductId("");
    setAddColor("");
    setAddSize("");
    setAddQty(1);
  };

  const saveEdit = async (orderId: string) => {
    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: draftLines.map((l) => ({
            id: l.itemCode,
            quantity: l.quantity,
            color: l.color,
            size: l.size,
          })),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        cancelEdit();
        load();
      } else {
        setEditError(data?.error ?? "Could not save these changes.");
      }
    } catch {
      setEditError("Could not reach the server.");
    } finally {
      setSavingEdit(false);
    }
  };

  const editPreview =
    editingId && draftLines.length > 0
      ? evaluateBundles(
          draftLines.map((l) => ({ id: l.itemCode, quantity: l.quantity, price: l.price })),
        )
      : null;

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
                  {/* The discount is shown next to the total rather than
                      folded into the line prices below, so `price × qty`
                      on each row still reconciles against what the
                      customer was quoted. */}
                  <div className="text-right">
                    <span className="text-zinc-900 font-semibold block">
                      ₱{order.total.toFixed(2)}
                    </span>
                    {!!order.bundleDiscount && order.bundleDiscount > 0 && (
                      <span className="block text-xs text-emerald-600">
                        ₱{(order.subtotal ?? order.total).toFixed(2)} − ₱
                        {order.bundleDiscount.toFixed(2)} bundle
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <ul className="text-sm text-zinc-600 mb-4 space-y-3">
                {order.items.map((item, i) => (
                  <li key={i} className="flex flex-col">
                    <div className="font-medium text-zinc-900">
                      {item.quantity}x {item.name || item.description || "Item"}
                      <span className="text-zinc-500 font-normal ml-2">
                        — ₱{(item.price * item.quantity).toFixed(2)} <span className="text-xs text-zinc-400">(₱{item.price.toFixed(2)} ea)</span>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 mt-1">
                      {item.brand && <span>Collection Name: {item.brand}</span>}
                      {item.brand && (item.color || item.size) && <span>&bull;</span>}
                      {(item.color || item.size) && (
                        <span>
                          {[item.color && `Color: ${item.color}`, item.size && `Size: ${item.size}`]
                            .filter(Boolean)
                            .join(" | ")}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {editingId === order._id && (
                <div className="mb-4 p-4 rounded-xl border border-dashed border-zinc-300 bg-zinc-50">
                  <p className="text-xs font-medium text-zinc-500 uppercase mb-3">
                    Edit items
                  </p>

                  <div className="space-y-2 mb-4">
                    {draftLines.map((line) => (
                      <div
                        key={line.key}
                        className="flex items-center justify-between gap-3 bg-surface border border-border rounded-lg px-3 py-2"
                      >
                        <div className="text-sm min-w-0">
                          <p className="font-medium text-zinc-900 truncate">{line.name}</p>
                          <p className="text-xs text-zinc-500">
                            {[line.color, line.size].filter(Boolean).join(" | ") || "—"}
                            {" · "}₱{line.price.toFixed(2)} ea
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            type="number"
                            min={1}
                            max={MAX_QUANTITY_PER_LINE}
                            value={line.quantity}
                            onChange={(e) =>
                              setLineQuantity(
                                line.key,
                                Math.max(0, Math.min(MAX_QUANTITY_PER_LINE, Number(e.target.value) || 0)),
                              )
                            }
                            className="w-16 px-2 py-1 text-sm rounded-lg border border-border text-center"
                          />
                          <button
                            onClick={() => removeLine(line.key)}
                            className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                    {draftLines.length === 0 && (
                      <p className="text-xs text-zinc-500">
                        No items left on this order — add at least one below.
                      </p>
                    )}
                  </div>

                  <div className="border-t border-zinc-200 pt-3 mb-3">
                    <p className="text-xs font-medium text-zinc-500 uppercase mb-2">Add item</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex flex-col gap-1">
                        <input
                          value={productFilter}
                          onChange={(e) => setProductFilter(e.target.value)}
                          placeholder="Filter products…"
                          className="px-2 py-1.5 text-xs rounded-lg border border-border w-40"
                        />
                        <select
                          value={addProductId}
                          onChange={(e) => {
                            setAddProductId(e.target.value);
                            setAddColor("");
                            setAddSize("");
                          }}
                          className="px-2 py-1.5 text-sm rounded-lg border border-border w-56"
                        >
                          <option value="">
                            {productsLoading ? "Loading products…" : "Select a product…"}
                          </option>
                          {(products ?? [])
                            .filter(
                              (p) =>
                                !productFilter.trim() ||
                                (p.name ?? "").toLowerCase().includes(productFilter.trim().toLowerCase()),
                            )
                            .map((p) => (
                              <option key={p._id} value={p._id}>
                                {p.name?.trim() || "(untitled)"}
                              </option>
                            ))}
                        </select>
                      </div>

                      {(selectedAddProduct?.colors?.length ?? 0) > 0 && (
                        <select
                          value={addColor}
                          onChange={(e) => setAddColor(e.target.value)}
                          className="px-2 py-1.5 text-sm rounded-lg border border-border"
                        >
                          <option value="">Colour…</option>
                          {selectedAddProduct?.colors?.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      )}

                      {(selectedAddProduct?.sizes?.length ?? 0) > 0 && (
                        <select
                          value={addSize}
                          onChange={(e) => setAddSize(e.target.value)}
                          className="px-2 py-1.5 text-sm rounded-lg border border-border"
                        >
                          <option value="">Size…</option>
                          {selectedAddProduct?.sizes?.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      )}

                      <input
                        type="number"
                        min={1}
                        max={MAX_QUANTITY_PER_LINE}
                        value={addQty}
                        onChange={(e) =>
                          setAddQty(Math.max(1, Math.min(MAX_QUANTITY_PER_LINE, Number(e.target.value) || 1)))
                        }
                        className="w-16 px-2 py-1.5 text-sm rounded-lg border border-border text-center"
                      />

                      <button
                        onClick={addLine}
                        disabled={!addProductId}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-40"
                      >
                        Add
                      </button>
                    </div>
                    {selectedAddProduct && (
                      <p className="text-xs text-zinc-500 mt-1">
                        {addProductVariant
                          ? `₱${addProductVariant.price.toFixed(2)} · ${addProductVariant.stock} in stock`
                          : `₱${selectedAddProduct.price.toFixed(2)} · ${selectedAddProduct.stock} in stock`}
                      </p>
                    )}
                  </div>

                  {editPreview && (
                    <div className="text-sm mb-3 space-y-1">
                      <p className="text-zinc-600">
                        Subtotal ₱{editPreview.subtotal.toFixed(2)}
                        {editPreview.discount > 0 && ` − ₱${editPreview.discount.toFixed(2)} bundle`}
                        {" = "}
                        <span className="font-semibold text-zinc-900">
                          ₱{editPreview.total.toFixed(2)}
                        </span>
                      </p>
                      {editPreview.shortGroups.length > 0 && (
                        <p className="text-xs text-amber-600">
                          Below the usual {MIN_UNITS_PER_PRODUCT}-piece minimum:{" "}
                          {editPreview.shortGroups
                            .map((g) => products?.find((p) => p._id === g.id)?.name?.trim() || "an item")
                            .join(", ")}
                          . This will still save.
                        </p>
                      )}
                    </div>
                  )}

                  {editError && <p className="text-xs text-red-600 mb-3">{editError}</p>}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => saveEdit(order._id)}
                      disabled={savingEdit || draftLines.length === 0}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {savingEdit ? "Saving…" : "Save changes"}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={savingEdit}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

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

                {order.status === "received" && (
                  <button
                    disabled={updatingId === order._id || savingEdit}
                    onClick={() =>
                      editingId === order._id ? cancelEdit() : startEdit(order)
                    }
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                  >
                    {editingId === order._id ? "Cancel edit" : "Edit order"}
                  </button>
                )}

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
