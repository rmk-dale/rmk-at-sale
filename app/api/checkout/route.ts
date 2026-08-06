import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyHash } from '@/lib/crypto';
import { sendReceiptEmail } from '@/lib/email';
import clientPromise, { getDb } from '@/lib/mongodb';
import type { ProductDoc } from '@/lib/models/product';
import type { OrderDoc, OrderItem } from '@/lib/models/order';

class InsufficientStockError extends Error {
  constructor(public itemDescription: string, public available: number) {
    super(`Insufficient stock for ${itemDescription}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Verify Authentication
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('session');

    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const { email, expires, hash } = JSON.parse(sessionCookie.value);

    if (Date.now() > expires || !verifyHash(`${email}|${expires}`, hash)) {
      return NextResponse.json({ error: 'Session invalid or expired.' }, { status: 401 });
    }

    // 2. Parse Checkout Request
    const { items } = await req.json();

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Cart is empty or invalid.' }, { status: 400 });
    }

    for (const cartItem of items) {
      if (!cartItem.id || typeof cartItem.quantity !== 'number' || cartItem.quantity <= 0) {
        return NextResponse.json({ error: 'Invalid cart item.' }, { status: 400 });
      }
    }

    // 3. Check stock, decrement it, and record the order — all inside one
    // transaction, so a shortfall on any single item rolls back everything,
    // and the order record can never exist without the stock it consumed.
    const client = await clientPromise;
    const db = await getDb();
    const products = db.collection<ProductDoc>('products');
    const orders = db.collection<OrderDoc>('orders');

    let totalAmount = 0;
    const purchasedItems: OrderItem[] = [];

    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        totalAmount = 0;
        purchasedItems.length = 0;

        for (const { id, quantity } of items) {
          const updated = await products.findOneAndUpdate(
            { _id: id, stock: { $gte: quantity } },
            { $inc: { stock: -quantity }, $set: { updatedAt: new Date() } },
            { session, returnDocument: 'after' }
          );

          if (!updated) {
            const existing = await products.findOne({ _id: id }, { session });
            if (!existing) {
              throw new InsufficientStockError(id, 0);
            }
            throw new InsufficientStockError(existing.description, existing.stock);
          }

          totalAmount += updated.price * quantity;
          purchasedItems.push({ itemCode: id, description: updated.description, quantity, price: updated.price });
        }

        const now = new Date();
        await orders.insertOne(
          {
            buyerEmail: email,
            items: purchasedItems,
            total: totalAmount,
            status: 'received',
            createdAt: now,
            updatedAt: now,
          },
          { session }
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
      throw err;
    } finally {
      await session.endSession();
    }

    // 4. Send Email Receipt — a delivery concern, not an inventory one, so a
    // failure here doesn't roll back the stock decrement or the order.
    try {
      await sendReceiptEmail(
        email,
        totalAmount,
        purchasedItems.map((item) => ({ name: item.description, quantity: item.quantity, price: item.price }))
      );
    } catch (emailError) {
      console.error('Order succeeded but receipt email failed to send:', emailError);
    }

    // 5. Respond with Success
    return NextResponse.json({
      success: true,
      message: 'Checkout successful! Receipt sent to your email.',
    });
  } catch (error) {
    console.error('Error processing checkout:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
