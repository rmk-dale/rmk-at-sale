import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

export interface OrderItem {
  itemCode: string;
  description: string;
  quantity: number;
  price: number;
}

export type OrderStatus = 'received' | 'fulfilled' | 'cancelled';

export interface OrderDoc {
  _id: ObjectId;
  buyerEmail: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

export async function getOrdersCollection() {
  const db = await getDb();
  return db.collection<OrderDoc>('orders');
}
