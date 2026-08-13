import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireAdmin } from "@/lib/adminGuard";
import clientPromise, { getDb } from "@/lib/mongodb";
import {
  getTransition,
  isOrderStatus,
  orderReference,
  resolveStockEffect,
  type OrderDoc,
  type OrderStatusEvent,
} from "@/lib/models/order";
import type { ProductDoc } from "@/lib/models/product";
import { invalidateProductCaches } from "@/lib/revalidate";
import { asString } from "@/lib/validation";
import { recordAudit } from "@/lib/models/auditLog";
import { getClientIp } from "@/lib/rateLimit";

/** Raised inside the transaction when a reopen can't reclaim its stock. */
class RestockUnavailableError extends Error {
  constructor(
    public itemDescription: string,
    public available: number,
  ) {
    super(`Insufficient stock to reopen: ${itemDescription}`);
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });
  }

  const orders = (await getDb()).collection<OrderDoc>("orders");
  const order = await orders.findOne({ _id: new ObjectId(id) });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  return NextResponse.json(order);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;

    // Previously this went straight into `new ObjectId(id)`, which throws
    // on malformed input and surfaced as an opaque 500.
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });
    }

    const body: unknown = await req.json();
    const raw =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};

    const status = raw.status;
    if (!isOrderStatus(status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }

    const note = raw.note === undefined ? undefined : asString(raw.note, 280);
    if (raw.note !== undefined && note === null) {
      return NextResponse.json(
        { error: "Note must be text of 280 characters or fewer." },
        { status: 400 },
      );
    }

    const client = await clientPromise;
    const db = await getDb();
    const orders = db.collection<OrderDoc>("orders");
    const products = db.collection<ProductDoc>("products");

    const order = await orders.findOne({ _id: new ObjectId(id) });
    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    if (order.status === status) {
      return NextResponse.json({ success: true, order });
    }

    // Only the moves listed in ORDER_TRANSITIONS are legal, and each states
    // its own stock consequence. Anything unlisted is refused rather than
    // silently applied.
    const transition = getTransition(order.status, status);
    if (!transition) {
      return NextResponse.json(
        {
          error: `An order cannot go from ${order.status} to ${status}.`,
        },
        { status: 409 },
      );
    }

    // Orders created before this change have neither flag; derive the
    // starting point from the status so the invariant holds for them too.
    const stockCurrentlyReleased =
      order.stockReleased ?? order.status === "cancelled";

    // Releasing an already-released order (or reserving an already-reserved
    // one) resolves to "none", which is the guard that stops
    // cancel → reopen → cancel restocking the same units twice.
    const { effect: stockEffect, stockReleased: nextStockReleased } =
      resolveStockEffect(transition, stockCurrentlyReleased);

    const now = new Date();
    const event: OrderStatusEvent = {
      from: order.status,
      to: status,
      at: now,
      actor: "admin",
      adminId: admin._id,
      adminUsername: admin.username,
      stockEffect,
      ...(note ? { note } : {}),
    };

    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        if (stockEffect === "released") {
          // Returning units to inventory. Guarded by `stockReleased`, so
          // cancel → reopen → cancel can no longer restock the same units
          // twice and inflate inventory.
          for (const item of order.items) {
            await products.updateOne(
              { _id: item.itemCode },
              { $inc: { stock: item.quantity }, $set: { updatedAt: now } },
              { session },
            );
          }
        } else if (stockEffect === "reserved") {
          // Reopening a cancelled order takes the units back out. This can
          // fail — they may have been sold in the meantime — so it uses the
          // same atomic `$gte` guard as checkout and aborts the whole
          // transaction if any line comes up short.
          for (const item of order.items) {
            const updated = await products.findOneAndUpdate(
              { _id: item.itemCode, stock: { $gte: item.quantity } },
              { $inc: { stock: -item.quantity }, $set: { updatedAt: now } },
              { session, returnDocument: "after" },
            );

            if (!updated) {
              const existing = await products.findOne(
                { _id: item.itemCode },
                { session },
              );
              throw new RestockUnavailableError(
                existing?.name ?? existing?.description ?? item.name ?? item.description ?? "Unknown item",
                existing?.stock ?? 0,
              );
            }
          }
        }

        // Conditional on the status we read a moment ago. If another admin
        // moved this order in between, the filter matches nothing and the
        // whole transaction aborts instead of clobbering their change.
        const result = await orders.updateOne(
          { _id: order._id, status: order.status },
          {
            $set: {
              status,
              stockReleased: nextStockReleased,
              updatedAt: now,
            },
            $push: { statusHistory: event },
          },
          { session },
        );

        if (result.matchedCount === 0) {
          throw new Error("CONCURRENT_MODIFICATION");
        }
      });
    } catch (err) {
      if (err instanceof RestockUnavailableError) {
        return NextResponse.json(
          {
            error:
              err.available > 0
                ? `Can't reopen: only ${err.available} left of ${err.itemDescription}.`
                : `Can't reopen: ${err.itemDescription} is out of stock.`,
          },
          { status: 409 },
        );
      }
      if (err instanceof Error && err.message === "CONCURRENT_MODIFICATION") {
        return NextResponse.json(
          {
            error:
              "This order was changed by someone else. Refresh and try again.",
          },
          { status: 409 },
        );
      }
      throw err;
    } finally {
      await session.endSession();
    }

    if (stockEffect !== "none") {
      // Cancelling or restocking an order touches several products at
      // once, so this clears every product page rather than one.
      invalidateProductCaches();
    }

    const updated = await orders.findOne({ _id: order._id });

    // The order's own statusHistory is the operational record; this puts
    // the same event in the single cross-cutting log alongside product,
    // brand and admin changes, so "what did this person do on Tuesday" is
    // answerable from one place.
    await recordAudit({
      admin,
      action: "order.status_change",
      targetType: "order",
      targetId: order._id.toString(),
      targetLabel: orderReference(order),
      changes: [
        { field: "status", from: order.status, to: status },
        ...(stockEffect !== "none"
          ? [{ field: "stock", from: null, to: stockEffect }]
          : []),
      ],
      ip: getClientIp(req),
    });

    return NextResponse.json({ success: true, order: updated });
  } catch (error) {
    console.error("Error updating order:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
