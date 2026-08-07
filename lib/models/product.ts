import { getDb } from "@/lib/mongodb";
import { createTTLCache } from "@/lib/cache";

export interface ColorVariant {
  name: string; // e.g. "Sporty Blue"
  hex?: string; // swatch color, e.g. "#3b6f8f"
  image: string; // path into public/items/ shown as the card/detail main photo for this color
  hoverImage?: string; // path into public/items/ shown on hover for this color
  isDefault?: boolean; // this color's photo is used as the product's main image/hoverImage
}

export interface ProductDoc {
  _id: string; // Item Code, e.g. "AT88G01001"
  name?: string; // We make this optional for backward compatibility
  description: string;
  price: number;
  stock: number;
  image: string; // path into public/items/, e.g. "/items/item1front.jpg"
  hoverImage?: string;
  brand?: string;
  sizes?: string[]; // e.g. ["55cm", "67cm", "78cm"]
  colors?: ColorVariant[];
  featured?: boolean;
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
  brand?: string;
  sizes?: string[];
  colors?: ColorVariant[];
  featured?: boolean;
}

export async function getProductsCollection() {
  const db = await getDb();
  return db.collection<ProductDoc>("products");
}

export function toPublicProduct(doc: ProductDoc): PublicProduct {
  return {
    id: doc._id,
    name: doc.name || doc.description,
    description: doc.description,
    price: doc.price,
    stock: doc.stock,
    image: doc.image,
    hoverImage: doc.hoverImage,
    brand: doc.brand,
    sizes: doc.sizes,
    colors: doc.colors,
    featured: doc.featured,
  };
}

// The storefront's product list is read on essentially every request and
// changes rarely (admin edits, or a checkout decrementing stock). Caching
// it for a short window means many concurrent shoppers share one Atlas
// query per container instead of each triggering their own full-collection
// scan. Kept short (15s) because `stock` needs to stay reasonably fresh —
// checkout itself is still protected by an atomic, transactional stock
// check regardless of what this cache shows, so a stale read here can never
// cause overselling, only a briefly stale "in stock" display.
const PUBLIC_PRODUCTS_TTL_MS = 15_000;
const publicProductsCache = createTTLCache<PublicProduct[]>(
  PUBLIC_PRODUCTS_TTL_MS,
);

export async function getPublicProducts(): Promise<PublicProduct[]> {
  return publicProductsCache.get(async () => {
    const products = await getProductsCollection();
    const all = await products.find().sort({ _id: 1 }).toArray();
    return all.map(toPublicProduct);
  });
}

/** Call after any write that changes product data or stock, so the
 * storefront doesn't serve a stale cached list until the TTL expires. */
export function invalidatePublicProductsCache() {
  publicProductsCache.invalidate();
}
