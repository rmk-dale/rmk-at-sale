import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminGuard';
import { getProductsCollection } from '@/lib/models/product';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { id } = await params;
    const { description, price, stock, image, hoverImage } = await req.json();

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (description !== undefined) {
      if (typeof description !== 'string' || !description.trim()) {
        return NextResponse.json({ error: 'Description cannot be empty.' }, { status: 400 });
      }
      update.description = description;
    }
    if (price !== undefined) {
      if (typeof price !== 'number' || price < 0) {
        return NextResponse.json({ error: 'Price must be a non-negative number.' }, { status: 400 });
      }
      update.price = price;
    }
    if (stock !== undefined) {
      if (typeof stock !== 'number' || stock < 0 || !Number.isInteger(stock)) {
        return NextResponse.json({ error: 'Stock must be a non-negative whole number.' }, { status: 400 });
      }
      update.stock = stock;
    }
    if (image !== undefined) {
      if (typeof image !== 'string' || !image) {
        return NextResponse.json({ error: 'Choose a photo for this item.' }, { status: 400 });
      }
      update.image = image;
    }
    if (hoverImage !== undefined) {
      update.hoverImage = hoverImage || undefined;
    }

    const products = await getProductsCollection();
    const result = await products.findOneAndUpdate(
      { _id: id },
      { $set: update },
      { returnDocument: 'after' }
    );

    if (!result) {
      return NextResponse.json({ error: `Item ${id} not found.` }, { status: 404 });
    }

    return NextResponse.json({ success: true, product: result });
  } catch (error) {
    console.error('Error updating product:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
