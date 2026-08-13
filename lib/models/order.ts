import { ObjectId, type ClientSession, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { OrderStatus } from "@/lib/orderTransitions";

// The status machine lives in lib/orderTransitions.ts, free of database
// imports so it can be tested in isolation. Re-exported here so callers
// have one place to import order concepts from.
export {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  getTransition,
  isOrderStatus,
  resolveStockEffect,
  type OrderStatus,
  type TransitionRule,
} from "@/lib/orderTransitions";

export interface OrderItem {
  itemCode: string;
  name?: string;
  brand?: string;
  description?: string;
  quantity: number;
  price: number;
  color?: string;
  size?: string;
}

/**
 * One entry in an order's audit trail. Written for the initial creation
 * and for every subsequent status change, so "who marked this fulfilled,
 * and when" is answerable from the order document alone.
 */
export interface OrderStatusEvent {
  from: OrderStatus | null; // null on creation
  to: OrderStatus;
  at: Date;
  actor: "customer" | "admin";
  adminId?: ObjectId;
  adminUsername?: string;
  /** Whether this transition moved stock, and in which direction. */
  stockEffect: "released" | "reserved" | "none";
  note?: string;
}

export interface OrderDoc {
  _id: ObjectId;
  /** Human-readable tracking reference, e.g. "RMK-2026-000042". */
  orderNumber: string;
  buyerEmail: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  /**
   * True when this order's units are currently sitting back in inventory
   * rather than being held by the order.
   *
   * Without this flag, status alone cannot tell you whether stock has been
   * returned: cancelling an order restocks it, and reopening it does not
   * re-deduct, so cancel → reopen → cancel used to restock the same units
   * twice and quietly inflate inventory. Every stock-moving transition is
   * now conditional on this flag, so the units can only ever be released
   * once and re-reserved once.
   */
  stockReleased: boolean;
  statusHistory: OrderStatusEvent[];
  createdAt: Date;
  updatedAt: Date;
}

let indexesEnsured = false;

export async function getOrdersCollection() {
  const db = await getDb();
  const collection = db.collection<OrderDoc>("orders");

  if (!indexesEnsured) {
    indexesEnsured = true;
    // createIndex is idempotent — safe to call on every cold start.
    await Promise.all([
      // Matches the admin order list's filter-by-status + sort-by-createdAt.
      collection.createIndex({ status: 1, createdAt: -1 }),
      // Tracking lookups, and the guarantee that a reference is unique.
      // Sparse so orders predating this field don't collide on null.
      collection.createIndex(
        { orderNumber: 1 },
        { unique: true, sparse: true },
      ),
      collection.createIndex({ buyerEmail: 1, createdAt: -1 }),
    ]).catch((err) => console.error("Failed to ensure order indexes:", err));
  }

  return collection;
}

// ---------------------------------------------------------------------------
// Order numbers
// ---------------------------------------------------------------------------

interface CounterDoc {
  _id: string;
  seq: number;
}

/**
 * Allocates the next order number.
 *
 * `findOneAndUpdate` with `$inc` is atomic, so two checkouts running in
 * different containers cannot be handed the same sequence value. Runs
 * inside the checkout transaction so a rolled-back order does not leave a
 * gap that looks like a lost order.
 */
export async function nextOrderNumber(
  db: Db,
  session: ClientSession,
): Promise<string> {
  const counters = db.collection<CounterDoc>("counters");
  const year = new Date().getFullYear();

  const counter = await counters.findOneAndUpdate(
    { _id: `orders:${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after", session },
  );

  const seq = counter?.seq ?? 1;
  return `RMK-${year}-${String(seq).padStart(6, "0")}`;
}

/** Reads back an order's tracking reference, tolerating pre-migration docs. */
export function orderReference(order: Pick<OrderDoc, "_id" | "orderNumber">) {
  return order.orderNumber || `LEGACY-${order._id.toString().slice(-8).toUpperCase()}`;
}
