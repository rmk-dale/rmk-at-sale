/**
 * The order status machine.
 *
 * Kept free of database imports so the rules can be reasoned about — and
 * tested — on their own. lib/models/order.ts re-exports these alongside
 * the document types.
 */

export type OrderStatus = "received" | "fulfilled" | "cancelled";

export const ORDER_STATUSES: readonly OrderStatus[] = [
  "received",
  "fulfilled",
  "cancelled",
] as const;

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

export interface TransitionRule {
  /**
   * What this move does to inventory:
   *  - `release` puts the order's units back on the shelf
   *  - `reserve` takes them off it again
   *  - `none`    leaves stock untouched
   *
   * Whether the move *actually* moves stock also depends on the order's
   * `stockReleased` flag: releasing an already-released order, or
   * reserving an already-reserved one, is a no-op. That guard is what
   * stops cancel → reopen → cancel from restocking the same units twice.
   */
  stock: "release" | "reserve" | "none";
  label: string;
}

/**
 * Which status changes are permitted. Modelling this explicitly — rather
 * than accepting any status and special-casing "cancelled" at the call
 * site — means an unlisted move is refused by default, and the stock
 * consequence of every legal move is stated in one place instead of being
 * implied by the order of a few ifs.
 */
export const ORDER_TRANSITIONS: Record<
  OrderStatus,
  Partial<Record<OrderStatus, TransitionRule>>
> = {
  received: {
    fulfilled: { stock: "none", label: "Marked fulfilled" },
    cancelled: { stock: "release", label: "Cancelled — stock returned" },
  },
  fulfilled: {
    received: { stock: "none", label: "Reopened" },
    cancelled: { stock: "release", label: "Cancelled — stock returned" },
  },
  cancelled: {
    // Reopening has to take the units back out of inventory, which can
    // fail if they have since been sold to someone else. The route handles
    // that case explicitly.
    received: { stock: "reserve", label: "Reopened — stock re-reserved" },
  },
};

export function getTransition(
  from: OrderStatus,
  to: OrderStatus,
): TransitionRule | null {
  return ORDER_TRANSITIONS[from]?.[to] ?? null;
}

/**
 * Works out what a transition actually does to stock, given whether the
 * order's units are currently released. Shared by the route and its tests
 * so both agree on the invariant.
 */
export function resolveStockEffect(
  rule: TransitionRule,
  stockCurrentlyReleased: boolean,
): { effect: "released" | "reserved" | "none"; stockReleased: boolean } {
  if (rule.stock === "release" && !stockCurrentlyReleased) {
    return { effect: "released", stockReleased: true };
  }
  if (rule.stock === "reserve" && stockCurrentlyReleased) {
    return { effect: "reserved", stockReleased: false };
  }
  return { effect: "none", stockReleased: stockCurrentlyReleased };
}
