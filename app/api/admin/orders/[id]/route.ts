import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/adminGuard';
import clientPromise, { getDb } from '@/lib/mongodb';
import type { OrderDoc, OrderStatus } from '@/lib/models/order';
import type { ProductDoc } from '@/lib/models/product';

const VALID_STATUSES: OrderStatus[] = ['received', 'fulfilled', 'cancelled'];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { id } = await params;
    const { status } = (await req.json()) as { status?: OrderStatus };

    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
    }

    const client = await clientPromise;
    const db = await getDb();
    const orders = db.collection<OrderDoc>('orders');
    const products = db.collection<ProductDoc>('products');

    const order = await orders.findOne({ _id: new ObjectId(id) });
    if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

    if (order.status === status) {
      return NextResponse.json({ success: true, order });
    }

    // Cancelling an order releases its items back into stock. This is the
    // one place stock changes outside of checkout, so it runs in its own
    // transaction for the same reason checkout does — multiple documents
    // (every line item) need to move together or not at all.
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        if (status === 'cancelled' && order.status !== 'cancelled') {
          for (const item of order.items) {
            await products.updateOne(
              { _id: item.itemCode },
              { $inc: { stock: item.quantity }, $set: { updatedAt: new Date() } },
              { session }
            );
          }
        }
        await orders.updateOne(
          { _id: order._id },
          { $set: { status, updatedAt: new Date() } },
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    const updated = await orders.findOne({ _id: order._id });
    return NextResponse.json({ success: true, order: updated });
  } catch (error) {
    console.error('Error updating order:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
