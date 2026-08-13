import { NextRequest, NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { sendReceiptEmail } from "@/lib/email";
import clientPromise, { getDb } from "@/lib/mongodb";
import {
  CUSTOMER_SESSION_COOKIE,
  verifyCustomerSession,
} from "@/lib/customerSession";
import {
  RATE_LIMITS,
  checkRateLimit,
  hashIdentifier,
  rateLimitResponse,
} from "@/lib/rateLimit";
import { validateCartItems } from "@/lib/validation";
import {
  DAILY_ORDER_COUNTED_STATUSES,
  DAILY_ORDER_LIMIT,
  DAILY_ORDER_WINDOW_MS,
  disallowedEmailMessage,
  isAllowedOrderEmail,
} from "@/lib/orderPolicy";
import type { ProductDoc } from "@/lib/models/product";
import { invalidateProductCaches } from "@/lib/revalidate";
import {
  nextOrderNumber,
  type OrderDoc,
  type OrderItem,
} from "@/lib/models/order";
import {
  acquireCheckoutSlot,
  releaseCheckoutSlot,
} from "@/lib/models/checkoutGate";

class InsufficientStockError extends Error {
  constructor(
    public itemDescription: string,
    public available: number,
  ) {
    super(`Insufficient stock for ${itemDescription}`);
  }
}

class InvalidVariantError extends Error {
  constructor(public detail: string) {
    super(detail);
  }
}

/** Raised inside the transaction when the address is over its daily cap. */
class DailyOrderLimitError extends Error {
  constructor(public placed: number) {
    super(`Daily order limit reached (${placed})`);
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate.
    const cookieStore = await cookies();
    const session = verifyCustomerSession(
      cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value,
    );

    if (!session) {
      return NextResponse.json(
        { error: "Session invalid or expired. Please log in again." },
        { status: 401 },
      );
    }

    const { email } = session;

    // 2. Re-check the domain allowlist against the session's own email.
    //
    // The OTP endpoint already refuses outside addresses, so this looks
    // redundant — it is not. Sessions last 24 hours and are signed, not
    // stored, so any session minted before this policy existed (or before
    // the allowlist was tightened) stays valid and would otherwise still
    // be able to order. Checking at the point of effect, not only at the
    // point of entry, is what makes the policy actually revocable.
    if (!isAllowedOrderEmail(email)) {
      return NextResponse.json(
        { error: disallowedEmailMessage() },
        { status: 403 },
      );
    }

    // 3. Rate limit per session. Cheap backstop against order spam from a
    // single authenticated mailbox; the concurrency gate below protects
    // the cluster, this protects the order book.
    const limit = await checkRateLimit(
      `checkout:${hashIdentifier(email)}`,
      RATE_LIMITS.checkoutPerSession,
    );
    if (!limit.ok) {
      return rateLimitResponse(
        limit,
        "Too many checkout attempts. Please wait a moment and try again.",
      );
    }

    // 4. Validate the cart.
    //
    // This is the fix for the operator-injection hole: `items` arrives as
    // `any` from `req.json()`, and previously only `!cartItem.id` stood
    // between the client and the product query, so `{"id":{"$gt":""}}`
    // reached Mongo as an operator and matched a product the shopper never
    // chose. `validateCartItems` requires `id` to be a string matching the
    // item-code shape and `quantity` to be a whole number in range, so
    // nothing but a literal SKU can reach the filter below.
    const body: unknown = await req.json();
    const cart =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).items
        : undefined;

    const validation = validateCartItems(cart);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const items = validation.items;

    // 5. Load-shed: cap how many checkouts run at once so a spike of
    // simultaneous requests can't all hammer a shared, throttled Atlas
    // free cluster together. Acquired after cheap validation (so a
    // malformed request doesn't consume a slot) and released as soon as
    // the DB work below is done, win or lose.
    const leaseId = await acquireCheckoutSlot();
    if (!leaseId) {
      return NextResponse.json(
        {
          error:
            "We're processing a lot of orders right now. Please try again in a few seconds.",
        },
        { status: 429, headers: { "Retry-After": "3" } },
      );
    }

    // 6. Check stock, decrement it, and record the order — all inside one
    // transaction, so a shortfall on any single item rolls back everything,
    // and the order record can never exist without the stock it consumed.
    const client = await clientPromise;
    const db = await getDb();
    const products = db.collection<ProductDoc>("products");
    const orders = db.collection<OrderDoc>("orders");

    let totalAmount = 0;
    let orderNumber = "";
    const purchasedItems: OrderItem[] = [];

    try {
      const mongoSession = client.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          totalAmount = 0;
          purchasedItems.length = 0;

          // Daily order cap, counted inside the transaction.
          //
          // Counting here rather than with the Redis limiter is deliberate
          // on two grounds. First, the cap is about orders actually
          // placed, and that is a fact recorded in Mongo — a request-rate
          // counter would also burn quota on checkouts that failed on
          // stock, costing a customer one of their ten for an order they
          // never got. Second, reading it inside the transaction closes
          // the race: two simultaneous checkouts cannot both observe nine
          // and both commit.
          //
          // A bounded `find` is used rather than countDocuments because a
          // plain find is unambiguously safe inside a transaction, and
          // there is no reason to count past the limit.
          const since = new Date(Date.now() - DAILY_ORDER_WINDOW_MS);
          const recent = await orders
            .find(
              {
                buyerEmail: email,
                createdAt: { $gte: since },
                status: { $in: [...DAILY_ORDER_COUNTED_STATUSES] },
              },
              {
                session: mongoSession,
                projection: { _id: 1 },
                limit: DAILY_ORDER_LIMIT,
              },
            )
            .toArray();

          if (recent.length >= DAILY_ORDER_LIMIT) {
            throw new DailyOrderLimitError(recent.length);
          }

          for (const { id, quantity, color, size } of items) {
            const product = await products.findOne(
              { _id: id },
              { session: mongoSession },
            );

            if (!product) {
              throw new InsufficientStockError(id, 0);
            }

            // Validations
            if (color && product.colors?.length) {
              const known = product.colors.some((c) => c.name === color);
              if (!known) {
                throw new InvalidVariantError(
                  `"${color}" is not an available colour for ${product.description}.`,
                );
              }
            } else if (color && !product.colors?.length) {
              throw new InvalidVariantError(
                `${product.description} does not come in different colours.`,
              );
            }

            if (size && product.sizes?.length) {
              if (!product.sizes.includes(size)) {
                throw new InvalidVariantError(
                  `"${size}" is not an available size for ${product.description}.`,
                );
              }
            } else if (size && !product.sizes?.length) {
              throw new InvalidVariantError(
                `${product.description} does not come in different sizes.`,
              );
            }

            // Variant pricing and stock logic
            let activeVariantIndex = -1;
            let activeVariant = null;

            if (product.variants && product.variants.length > 0) {
              activeVariantIndex = product.variants.findIndex(
                (v) =>
                  (v.color === color || (!v.color && !color)) &&
                  (v.size === size || (!v.size && !size))
              );
              if (activeVariantIndex !== -1) {
                activeVariant = product.variants[activeVariantIndex];
              }
            }

            const itemPrice = activeVariant ? activeVariant.price : product.price;

            if (activeVariant) {
              if (activeVariant.stock < quantity) {
                throw new InsufficientStockError(
                  `${product.description} (${[color, size].filter(Boolean).join(" ")})`,
                  activeVariant.stock
                );
              }
              await products.updateOne(
                { _id: id },
                { 
                  $inc: { [`variants.${activeVariantIndex}.stock`]: -quantity },
                  $set: { updatedAt: new Date() }
                },
                { session: mongoSession }
              );
            } else {
              if (product.stock < quantity) {
                throw new InsufficientStockError(
                  product.description,
                  product.stock
                );
              }
              await products.updateOne(
                { _id: id },
                { 
                  $inc: { stock: -quantity },
                  $set: { updatedAt: new Date() }
                },
                { session: mongoSession }
              );
            }

            totalAmount += itemPrice * quantity;
            purchasedItems.push({
              itemCode: id,
              name: product.name || product.description,
              brand: product.brand,
              description: product.description,
              quantity,
              price: itemPrice,
              color,
              size,
            });
          }

          const now = new Date();
          orderNumber = await nextOrderNumber(db, mongoSession);

          await orders.insertOne(
            {
              _id: new ObjectId(),
              orderNumber,
              buyerEmail: email,
              items: purchasedItems,
              total: totalAmount,
              status: "received",
              stockReleased: false,
              statusHistory: [
                {
                  from: null,
                  to: "received",
                  at: now,
                  actor: "customer",
                  stockEffect: "reserved",
                },
              ],
              createdAt: now,
              updatedAt: now,
            },
            { session: mongoSession },
          );
        });
      } catch (err) {
        if (err instanceof InsufficientStockError) {
          const message =
            err.available > 0
              ? `Only ${err.available} left of ${err.itemDescription}.`
              : `${err.itemDescription} is out of stock.`;
          return NextResponse.json({ error: message }, { status: 409 });
        }
        if (err instanceof InvalidVariantError) {
          return NextResponse.json({ error: err.detail }, { status: 400 });
        }
        if (err instanceof DailyOrderLimitError) {
          return NextResponse.json(
            {
              error: `You've placed ${DAILY_ORDER_LIMIT} orders in the last 24 hours, which is the limit. Please try again tomorrow, or contact the team if you need more.`,
            },
            { status: 429 },
          );
        }
        throw err;
      } finally {
        await mongoSession.endSession();
      }
    } finally {
      await releaseCheckoutSlot(leaseId);
    }

    // Stock just changed — drop the cached product list and the rendered
    // storefront pages so the next read reflects it instead of waiting out
    // the TTL. An order can span several products, so this clears them all.
    invalidateProductCaches();

    // 7. Send the receipt after the response, not before it.
    //
    // The order is already committed by this point, so the receipt is a
    // delivery concern and a failure must not roll anything back. It also
    // has no business making the shopper wait: awaiting Gmail here added a
    // second or two of spinner to every checkout, and a slow or hung SMTP
    // connection would hold the function open until the platform killed it.
    //
    // A bare fire-and-forget promise would not work on serverless — the
    // function is frozen once the response is returned, killing anything
    // still in flight. `after` is Next's supported way to keep work alive
    // past the response for exactly this case.
    const receiptItems = purchasedItems.map((item) => ({
      name: item.name || item.description || "Item",
      brand: item.brand,
      itemCode: item.itemCode,
      quantity: item.quantity,
      price: item.price,
      color: item.color,
      size: item.size,
    }));
    const receiptTotal = totalAmount;
    const receiptOrderNumber = orderNumber;

    after(async () => {
      try {
        await sendReceiptEmail(
          email,
          receiptTotal,
          receiptItems,
          receiptOrderNumber,
        );
      } catch (emailError) {
        // The order exists and the customer has already been told so. This
        // needs to be findable in the logs, because the only other signal
        // is a customer who never got their receipt.
        console.error(
          `[checkout] Order ${receiptOrderNumber} committed but the receipt email failed:`,
          emailError,
        );
      }
    });

    // 8. Respond with Success
    return NextResponse.json({
      success: true,
      orderNumber,
      message: `Checkout successful! Your order reference is ${orderNumber}. A receipt is on its way to your email.`,
    });
  } catch (error) {
    console.error("Error processing checkout:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
