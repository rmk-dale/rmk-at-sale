import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import { requireAdmin } from "@/lib/adminGuard";
import { productLabel } from "@/lib/models/product";
import clientPromise, { getDb } from "@/lib/mongodb";
import { orderReference, type OrderDoc, type OrderItem } from "@/lib/models/order";
import type { ProductDoc } from "@/lib/models/product";
import { invalidateProductCaches } from "@/lib/revalidate";
import {
  buildStockReleaseOp,
  buildStockReserveOp,
  resolveOrderLineVariant,
} from "@/lib/orderStock";
import {
  bundleMinimumMessage,
  evaluateBundles,
  validateCartItems,
} from "@/lib/validation";
import { recordAudit } from "@/lib/models/auditLog";
import { getClientIp } from "@/lib/rateLimit";

/**
 * Admin edits to an already-placed order's item list.
 *
 * Deliberately its own route rather than folded into the status-transition
 * PATCH at `[id]/route.ts`: that one moves an order through a fixed status
 * machine, this one recomputes the item list and the money it implies.
 * Keeping them apart keeps each one's transaction small and its failure
 * modes legible.
 *
 * Editing is only offered — and only accepted — while an order is
 * `received`. That is the one status where stock is guaranteed to be
 * reserved (`stockReleased: false`) and nothing has shipped, so every
 * quantity change below has an unambiguous stock consequence. Fulfilled
 * and cancelled orders are locked.
 *
 * A line's `price` is fixed the moment it first appears on the order.
 * Increasing an existing line's quantity later does not re-price it — it
 * is still the same variant that was already quoted. Only a genuinely new
 * line (never on the order before) is priced fresh, off the live product
 * document. This mirrors the rule in lib/models/order.ts that `price`
 * is "the variant price the shopper was actually quoted", never a number
 * invented after the fact.
 */

class InvalidVariantError extends Error {
  constructor(public detail: string) {
    super(detail);
  }
}

class InsufficientStockError extends Error {
  constructor(
    public itemDescription: string,
    public available: number,
  ) {
    super(`Insufficient stock for ${itemDescription}`);
  }
}

/** Raised when a guarded stock write matched fewer docs than it should have. */
class ConcurrentStockChangeError extends Error {
  constructor() {
    super("Stock changed while the order was being edited");
  }
}

function lineKey(id: string, color?: string, size?: string) {
  return `${id}|${color ?? ""}|${size ?? ""}`;
}

/** Throws if `color`/`size` aren't legitimate choices for `product` today. */
function validateVariantSelection(product: ProductDoc, color?: string, size?: string) {
  if (color && product.colors?.length) {
    const known = product.colors.some((c) => c.name === color);
    if (!known) {
      throw new InvalidVariantError(
        `"${color}" is not an available colour for ${productLabel(product)}.`,
      );
    }
  } else if (color && !product.colors?.length) {
    throw new InvalidVariantError(
      `${productLabel(product)} does not come in different colours.`,
    );
  }

  if (size && product.sizes?.length) {
    if (!product.sizes.includes(size)) {
      throw new InvalidVariantError(
        `"${size}" is not an available size for ${productLabel(product)}.`,
      );
    }
  } else if (size && !product.sizes?.length) {
    throw new InvalidVariantError(
      `${productLabel(product)} does not come in different sizes.`,
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });
    }

    const body: unknown = await req.json();
    const raw =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};

    // Reuses the exact validation checkout trusts for cart payloads: `id`
    // must match the item-code shape (never a Mongo operator), quantity a
    // bounded whole number, and no line repeated. See lib/validation.ts.
    const validation = validateCartItems(raw.items);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const submitted = validation.items;

    const client = await clientPromise;
    const db = await getDb();
    const orders = db.collection<OrderDoc>("orders");
    const products = db.collection<ProductDoc>("products");

    const order = await orders.findOne({ _id: new ObjectId(id) });
    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    if (order.status !== "received") {
      return NextResponse.json(
        { error: "Only orders that are still 'received' can be edited." },
        { status: 409 },
      );
    }

    const oldByKey = new Map(
      order.items.map((item) => [
        lineKey(item.itemCode, item.color, item.size),
        item,
      ]),
    );
    const submittedByKey = new Map(
      submitted.map((line) => [lineKey(line.id, line.color, line.size), line]),
    );
    const allKeys = new Set([...oldByKey.keys(), ...submittedByKey.keys()]);

    const productIds = new Set<string>();
    for (const item of order.items) productIds.add(item.itemCode);
    for (const line of submitted) productIds.add(line.id);

    let subtotalAmount = 0;
    let bundleDiscount = 0;
    let totalAmount = 0;
    let finalItems: OrderItem[] = [];
    let shortGroupNames: string[] = [];

    const mongoSession = client.startSession();
    try {
      await mongoSession.withTransaction(async () => {
        finalItems = [];
        subtotalAmount = 0;
        bundleDiscount = 0;
        totalAmount = 0;
        shortGroupNames = [];

        const cartProducts = await products
          .find({ _id: { $in: [...productIds] } }, { session: mongoSession })
          .toArray();
        const productsById = new Map(cartProducts.map((doc) => [doc._id, doc]));

        const stockOps: AnyBulkWriteOperation<ProductDoc>[] = [];
        const writtenAt = new Date();

        for (const key of allKeys) {
          const before = oldByKey.get(key);
          const after = submittedByKey.get(key);
          const oldQty = before?.quantity ?? 0;
          const newQty = after?.quantity ?? 0;
          const delta = newQty - oldQty;

          if (newQty <= 0) {
            // Removed entirely. Release its stock if there's still a
            // product to credit it back to — best-effort, never blocks
            // the edit.
            if (before && oldQty > 0) {
              const product = productsById.get(before.itemCode);
              if (product) {
                const { activeVariant, activeVariantIndex } = resolveOrderLineVariant(
                  product,
                  before.color,
                  before.size,
                );
                stockOps.push(
                  buildStockReleaseOp(before.itemCode, activeVariant, activeVariantIndex, oldQty, writtenAt),
                );
              }
            }
            continue;
          }

          if (delta === 0 && before) {
            // Untouched line — carried over exactly as it was.
            finalItems.push(before);
            continue;
          }

          const itemCode = after!.id;
          const color = after!.color;
          const size = after!.size;
          const product = productsById.get(itemCode);

          if (delta > 0) {
            // A brand-new line, or an existing one growing — either way
            // we're about to take more stock, so this is the one case
            // that has to be checked against the live catalogue.
            if (!product) {
              throw new InvalidVariantError(
                "That item is no longer in the catalogue, so its quantity can't be increased.",
              );
            }
            validateVariantSelection(product, color, size);
            const { activeVariant, activeVariantIndex } = resolveOrderLineVariant(product, color, size);
            if (product.variants?.length && !activeVariant) {
              throw new InvalidVariantError(
                `That combination of ${productLabel(product)} is no longer available.`,
              );
            }

            const availableStock = activeVariant ? activeVariant.stock : product.stock;
            if (availableStock < delta) {
              const label = `${productLabel(product)}${
                color || size ? ` (${[color, size].filter(Boolean).join(" ")})` : ""
              }`;
              throw new InsufficientStockError(label, availableStock);
            }

            stockOps.push(buildStockReserveOp(itemCode, activeVariant, activeVariantIndex, delta, writtenAt));

            const price = before ? before.price : activeVariant ? activeVariant.price : product.price;
            finalItems.push({
              itemCode,
              name: before?.name ?? productLabel(product),
              brand: before?.brand ?? product.brand,
              quantity: newQty,
              price,
              color,
              size,
            });
          } else {
            // Quantity reduced but the line survives. Best-effort release
            // against whatever the catalogue looks like today; this never
            // throws, because shrinking an order should never fail.
            if (product) {
              const { activeVariant, activeVariantIndex } = resolveOrderLineVariant(product, color, size);
              stockOps.push(
                buildStockReleaseOp(itemCode, activeVariant, activeVariantIndex, -delta, writtenAt),
              );
            }
            finalItems.push({ ...before!, quantity: newQty });
          }
        }

        if (stockOps.length > 0) {
          const stockResult = await products.bulkWrite(stockOps, {
            session: mongoSession,
            ordered: true,
          });
          if (stockResult.matchedCount !== stockOps.length) {
            throw new ConcurrentStockChangeError();
          }
        }

        // Same authority as checkout: the figures that land on the order
        // are only ever the ones computed here, from prices resolved
        // inside this transaction — never anything the client sent.
        //
        // Below the 2-piece minimum is allowed to save (this is a manual
        // correction, not a new checkout), but the shortfall is surfaced
        // back to the caller as a non-blocking warning.
        const bundles = evaluateBundles(
          finalItems.map((item) => ({ id: item.itemCode, quantity: item.quantity, price: item.price })),
        );
        subtotalAmount = bundles.subtotal;
        bundleDiscount = bundles.discount;
        totalAmount = bundles.total;
        shortGroupNames = bundles.shortGroups.map((group) => {
          const doc = productsById.get(group.id);
          return (doc ? productLabel(doc) : "") || "An item";
        });

        const result = await orders.updateOne(
          { _id: order._id, status: "received", updatedAt: order.updatedAt },
          {
            $set: {
              items: finalItems,
              subtotal: subtotalAmount,
              bundleDiscount,
              total: totalAmount,
              updatedAt: writtenAt,
            },
          },
          { session: mongoSession },
        );

        if (result.matchedCount === 0) {
          throw new Error("CONCURRENT_MODIFICATION");
        }
      });
    } catch (err) {
      if (err instanceof InvalidVariantError) {
        return NextResponse.json({ error: err.detail }, { status: 400 });
      }
      if (err instanceof InsufficientStockError) {
        const message =
          err.available > 0
            ? `Only ${err.available} left of ${err.itemDescription}.`
            : `${err.itemDescription} is out of stock.`;
        return NextResponse.json({ error: message }, { status: 409 });
      }
      if (err instanceof ConcurrentStockChangeError) {
        return NextResponse.json(
          {
            error:
              "Stock changed while saving. Please review the order and try again.",
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
      await mongoSession.endSession();
    }

    // Every path that reaches here touched at least the order; most also
    // touched stock, so clear the product caches unconditionally rather
    // than tracking whether stockOps was non-empty across the try block.
    invalidateProductCaches();

    const updated = await orders.findOne({ _id: order._id });

    await recordAudit({
      admin,
      action: "order.items_change",
      targetType: "order",
      targetId: order._id.toString(),
      targetLabel: orderReference(order),
      changes: [
        { field: "items", from: order.items, to: finalItems },
        { field: "total", from: order.total, to: totalAmount },
      ],
      ip: getClientIp(req),
    });

    return NextResponse.json({
      success: true,
      order: updated,
      ...(shortGroupNames.length > 0
        ? { warning: bundleMinimumMessage(shortGroupNames) }
        : {}),
    });
  } catch (error) {
    console.error("Error editing order items:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
