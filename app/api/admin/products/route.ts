import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminGuard';
import { getProductsCollection } from '@/lib/models/product';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const products = await getProductsCollection();
  const all = await products.find().sort({ _id: 1 }).toArray();
  return NextResponse.json(all);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { itemCode, description, price, stock, image, hoverImage } = await req.json();

    if (!itemCode || typeof itemCode !== 'string') {
      return NextResponse.json({ error: 'Item Code is required.' }, { status: 400 });
    }
    if (!description || typeof description !== 'string') {
      return NextResponse.json({ error: 'Description is required.' }, { status: 400 });
    }
    if (typeof price !== 'number' || price < 0) {
      return NextResponse.json({ error: 'Price must be a non-negative number.' }, { status: 400 });
    }
    if (typeof stock !== 'number' || stock < 0 || !Number.isInteger(stock)) {
      return NextResponse.json({ error: 'Stock must be a non-negative whole number.' }, { status: 400 });
    }
    if (!image || typeof image !== 'string') {
      return NextResponse.json({ error: 'Choose a photo for this item.' }, { status: 400 });
    }

    const products = await getProductsCollection();
    const existing = await products.findOne({ _id: itemCode });
    if (existing) {
      return NextResponse.json({ error: `Item Code ${itemCode} already exists.` }, { status: 409 });
    }

    const now = new Date();
    await products.insertOne({
      _id: itemCode,
      description,
      price,
      stock,
      image,
      hoverImage: hoverImage || undefined,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ success: true, id: itemCode });
  } catch (error) {
    console.error('Error adding product:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
