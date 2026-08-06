import { NextResponse } from 'next/server';
import { getProductsCollection, toPublicProduct } from '@/lib/models/product';

export async function GET() {
  try {
    const products = await getProductsCollection();
    const all = await products.find().sort({ _id: 1 }).toArray();
    return NextResponse.json(all.map(toPublicProduct));
  } catch (error) {
    console.error('Error fetching products:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
