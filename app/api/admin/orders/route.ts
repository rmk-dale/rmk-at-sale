import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminGuard';
import { getOrdersCollection, type OrderStatus } from '@/lib/models/order';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const status = req.nextUrl.searchParams.get('status') as OrderStatus | null;
  const filter = status ? { status } : {};

  const orders = await getOrdersCollection();
  const all = await orders.find(filter).sort({ createdAt: -1 }).toArray();
  return NextResponse.json(all);
}
