import { getDb } from '@/lib/mongodb';

export interface ProductDoc {
  _id: string;          // Item Code, e.g. "AT88G01001"
  description: string;
  price: number;
  stock: number;
  image: string;         // path into public/items/, e.g. "/items/item1front.jpg"
  hoverImage?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Shape returned to the browser — same fields the frontend already expects. */
export interface PublicProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  image: string;
  hoverImage?: string;
}

export async function getProductsCollection() {
  const db = await getDb();
  return db.collection<ProductDoc>('products');
}

export function toPublicProduct(doc: ProductDoc): PublicProduct {
  return {
    id: doc._id,
    name: doc.description,
    description: doc.description,
    price: doc.price,
    stock: doc.stock,
    image: doc.image,
    hoverImage: doc.hoverImage,
  };
}
