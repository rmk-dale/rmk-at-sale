import { NextRequest, NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import { sendNewOrderAdminEmail, sendReceiptEmail } from "@/lib/email";
import { getOrderNotifyRecipient } from "@/lib/models/admin";
import clientPromise, { getDb } from "@/lib/mongodb";
import {
  CUSTOMER_SESSION_COOKIE,
  verifyCustomerSession,
} from "@/lib/customerSession";
import { productLabel } from "@/lib/models/product";
import {
  RATE_LIMITS,
  checkRateLimit,
  hashIdentifier,
  rateLimitResponse,
} from "@/lib/rateLimit";
import {
  MIN_UNITS_PER_PRODUCT,
  bundleMinimumMessage,
  evaluateBundles,
  validateCartItems,
} from "@/lib/validation";
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
} from "@/lib/checkoutGate";

class InsufficientStockError extends Error {
  constructor(
    public itemDescription: string,
    public available: number,
  ) {
    super(`Insufficient stock for ${itemDescription}`);
  }
}

/**
 * Raised when the batched stock decrement matches fewer documents than it
 * has operations.
 *
 * Distinct from `InsufficientStockError`, which is raised from the read a
 * few lines earlier and can therefore name the item and the shortfall.
 * This one means the guards in the write disagreed with that read — either
 * another checkout took the last unit in between, or the same product
 * appears on two cart lines that together exceed its stock. Neither case
 * can be attributed to a specific line without another query, and buying
 * a better error message for a rare race is not worth a round trip inside
 * an open transaction.
 */
class ConcurrentStockChangeError extends Error {
  constructor() {
    super("Stock changed while the order was being placed");
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

/**
 * Raised when a product appears on the order fewer than
 * `MIN_UNITS_PER_PRODUCT` times.
 *
 * Checked inside the transaction rather than ahead of it, even though the
 * rule is about quantities and needs no database at all. The reason is the
 * message: before the product read there is nothing to call the offending
 * item but its ObjectId hex, and "68f2c1a9… needs at least 2 pieces" tells
 * a shopper nothing about which thing in their cart to fix. By this point
 * the documents are in hand and the error can name them. The cart blocks
 * this case client-side anyway, so the wasted concurrency slot is paid
 * only by a tampered or stale cart.
 */
class BundleMinimumError extends Error {
  constructor(public names: string[]) {
    super(`Below the ${MIN_UNITS_PER_PRODUCT}-piece minimum`);
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
    //
    // The gate lives in Redis rather than Mongo — see lib/checkoutGate.ts
    // for why. It costs this route zero Atlas operations.
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
    //
    // The transaction is deliberately kept short. Write-conflict
    // probability scales with how long a transaction stays open, and
    // `withTransaction` resolves a conflict by retrying *everything* — so
    // each round trip removed from in here is worth more than its own
    // cost. What remains is four operations regardless of cart size: the
    // daily-cap read, one batched product read, one batched stock write,
    // and the order insert.
    const client = await clientPromise;
    const db = await getDb();
    const products = db.collection<ProductDoc>("products");
    const orders = db.collection<OrderDoc>("orders");

    // `subtotalAmount` is what the lines come to before the bundle rules;
    // `totalAmount` is what is actually charged. They differ by
    // `bundleDiscount`, and all three are stored on the order so the
    // arithmetic on a receipt can be checked against the record.
    let subtotalAmount = 0;
    let bundleDiscount = 0;
    let totalAmount = 0;
    let orderNumber = "";
    const purchasedItems: OrderItem[] = [];

    try {
      // Allocated before the transaction opens, not inside it. Every
      // checkout increments the same counter document, so doing it in the
      // transaction made concurrent checkouts conflict and retry each
      // other's entire body. The trade is that a checkout which later
      // fails on stock burns a number and leaves a gap in the sequence.
      // See `nextOrderNumber` in lib/models/order.ts for the full
      // reasoning.
      orderNumber = await nextOrderNumber(db);

      const mongoSession = client.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          // Reset, not just initialise: `withTransaction` retries the whole
          // body on a write conflict, and these outlive a single attempt.
          subtotalAmount = 0;
          bundleDiscount = 0;
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

          // Every product on the cart, in one query.
          //
          // This replaced a `findOne` per cart line. The loop below then
          // runs with no round trips in it at all, which is what makes the
          // transaction's cost independent of how many items someone
          // bought.
          const cartProducts = await products
            .find(
              { _id: { $in: items.map((item) => item.id) } },
              { session: mongoSession },
            )
            .toArray();
          const productsById = new Map(
            cartProducts.map((doc) => [doc._id, doc]),
          );

          // Stock decrements are accumulated here and sent as one write
          // once every line has been validated and priced.
          const stockOps: AnyBulkWriteOperation<ProductDoc>[] = [];
          const writtenAt = new Date();

          for (const { id, quantity, color, size } of items) {
            const product = productsById.get(id);

            if (!product) {
              throw new InsufficientStockError(id, 0);
            }

            // Validations
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

            // Two checks guard every decrement, and they do different
            // jobs. The one here reads the snapshot fetched above, so it
            // can name the item and say how many are left — that is what
            // produces a useful message for the shopper. The `$gte` in
            // each filter below is the authoritative one: it is evaluated
            // by the server at write time, so stock can never go negative
            // even if the snapshot was a moment stale.
            if (activeVariant) {
              if (activeVariant.stock < quantity) {
                throw new InsufficientStockError(
                  `${productLabel(product)} (${[color, size].filter(Boolean).join(" ")})`,
                  activeVariant.stock
                );
              }
              stockOps.push({
                updateOne: {
                  filter: {
                    _id: id,
                    [`variants.${activeVariantIndex}.stock`]: { $gte: quantity },
                  },
                  update: {
                    $inc: { [`variants.${activeVariantIndex}.stock`]: -quantity },
                    $set: { updatedAt: writtenAt },
                  },
                },
              } as AnyBulkWriteOperation<ProductDoc>);
            } else {
              if (product.stock < quantity) {
                throw new InsufficientStockError(
                  productLabel(product),
                  product.stock
                );
              }
              stockOps.push({
                updateOne: {
                  filter: { _id: id, stock: { $gte: quantity } },
                  update: {
                    $inc: { stock: -quantity },
                    $set: { updatedAt: writtenAt },
                  },
                },
              } as AnyBulkWriteOperation<ProductDoc>);
            }

            purchasedItems.push({
              itemCode: id,
              name: productLabel(product),
              brand: product.brand,
              quantity,
              price: itemPrice,
              color,
              size,
            });
          }

          // The bundle rules, applied to the order exactly as priced above.
          //
          // This is the authority. The cart runs the same function to
          // decide what to show and whether to enable its button, but a
          // client can send whatever it likes — the figures that reach the
          // order document are only ever the ones computed here, from
          // variant prices read inside this transaction.
          //
          // Grouping is by product id, so two lines that differ only in
          // colour or size count toward the same minimum and the same
          // bundle. `purchasedItems` is already keyed that way, one entry
          // per validated line, so it is the input as-is.
          const bundles = evaluateBundles(
            purchasedItems.map((item) => ({
              id: item.itemCode,
              quantity: item.quantity,
              price: item.price,
            })),
          );

          // Raised before the stock write, so a cart that breaks the rule
          // costs nothing beyond the reads that have already happened.
          if (!bundles.ok) {
            throw new BundleMinimumError(
              bundles.shortGroups.map((group) => {
                const doc = productsById.get(group.id);
                return (doc ? productLabel(doc) : "") || "An item";
              }),
            );
          }

          subtotalAmount = bundles.subtotal;
          bundleDiscount = bundles.discount;
          totalAmount = bundles.total;

          // Every stock decrement on the order, in one write.
          //
          // `ordered: true` matters when the same product appears on two
          // cart lines — different colours of one bag, say, that both fall
          // back to product-level stock. Ordered application means the
          // second line's `$gte` guard sees the first line's decrement, so
          // two lines cannot between them take more stock than exists.
          const stockResult = await products.bulkWrite(stockOps, {
            session: mongoSession,
            ordered: true,
          });

          // A filter that didn't match means its `$gte` guard failed: the
          // stock is no longer there. Aborting rolls back any decrement
          // that did land, along with the order itself.
          if (stockResult.matchedCount !== stockOps.length) {
            throw new ConcurrentStockChangeError();
          }

          const now = new Date();

          await orders.insertOne(
            {
              _id: new ObjectId(),
              orderNumber,
              buyerEmail: email,
              items: purchasedItems,
              // `OrderItem.price` stays the true unit price of the variant.
              // Folding the discount into it would put a price on the
              // receipt that the shopper was never quoted, which is the
              // same class of mistake as the `originalPrice` aggregate
              // leak — so the discount is recorded once, here, at the
              // order level.
              subtotal: subtotalAmount,
              bundleDiscount,
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
        if (err instanceof ConcurrentStockChangeError) {
          return NextResponse.json(
            {
              error:
                "Someone just bought the last of something in your cart. Please refresh and try again.",
            },
            { status: 409 },
          );
        }
        if (err instanceof InvalidVariantError) {
          return NextResponse.json({ error: err.detail }, { status: 400 });
        }
        if (err instanceof BundleMinimumError) {
          return NextResponse.json(
            { error: bundleMinimumMessage(err.names) },
            { status: 400 },
          );
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
      quantity: item.quantity,
      price: item.price,
      color: item.color,
      size: item.size,
    }));
    const receiptTotal = totalAmount;
    const receiptOrderNumber = orderNumber;
    const receiptBreakdown = {
      subtotal: subtotalAmount,
      bundleDiscount,
    };

    after(async () => {
      try {
        await sendReceiptEmail(
          email,
          receiptTotal,
          receiptItems,
          receiptOrderNumber,
          receiptBreakdown,
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

      // Notify whichever admin is assigned in the Admins tab.
      //
      // Deliberately a second, separate try/catch rather than another
      // statement in the one above: the shopper's receipt is the more
      // important of the two, and a thrown SMTP error on this send must
      // not be able to prevent it. Sequenced after it for the same reason.
      //
      // The recipient lookup is one uncached `findOne` per order, which is
      // fine here — this runs after the response, outside the transaction,
      // at order rate rather than request rate. See the note on
      // `getOrderNotifyRecipient` for why caching it would be a
      // regression rather than an optimisation.
      try {
        const recipient = await getOrderNotifyRecipient();
        if (!recipient) {
          // Not an error: nobody is assigned. Logged anyway, because
          // "orders are arriving and no human is being told" is a state
          // worth being able to find after the fact.
          console.warn(
            `[checkout] Order ${receiptOrderNumber}: no admin is assigned to receive order notifications.`,
          );
          return;
        }

        const appUrl = process.env.APP_URL || "https://rmk-at-sale.vercel.app";

        await sendNewOrderAdminEmail(
          recipient.email,
          {
            orderNumber: receiptOrderNumber,
            buyerEmail: email,
            items: receiptItems,
            subtotal: receiptBreakdown.subtotal,
            bundleDiscount: receiptBreakdown.bundleDiscount,
            total: receiptTotal,
          },
          `${appUrl}/admin/orders`,
        );
      } catch (notifyError) {
        console.error(
          `[checkout] Order ${receiptOrderNumber} committed but the admin notification failed:`,
          notifyError,
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
