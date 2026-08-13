import { getDb } from "@/lib/mongodb";
import { createTTLCache } from "@/lib/cache";

export interface ColorVariant {
  name: string; // e.g. "Sporty Blue"
  hex?: string; // swatch color, e.g. "#3b6f8f"
  image: string; // path into public/items/ shown as the card/detail main photo for this color
  hoverImage?: string; // path into public/items/ shown on hover for this color
  isDefault?: boolean; // this color's photo is used as the product's main image/hoverImage
}

export interface ProductVariant {
  color?: string; // Must match one of the colors, or undefined if product has no colors
  size?: string;  // Must match one of the sizes, or undefined if product has no sizes
  price: number;
  originalPrice?: number;
  stock: number;
}

export interface ProductDoc {
  _id: string; // Item Code, e.g. "AT88G01001"
  name?: string; // We make this optional for backward compatibility
  description: string;
  price: number;
  originalPrice?: number;
  stock: number;
  image: string; // path into public/items/, e.g. "/items/item1front.jpg"
  hoverImage?: string;
  brand?: string;
  sizes?: string[]; // e.g. ["55cm", "67cm", "78cm"]
  colors?: ColorVariant[];
  variants?: ProductVariant[]; // Price and stock matrix
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
  originalPrice?: number;
  stock: number;
  image: string;
  hoverImage?: string;
  brand?: string;
  sizes?: string[];
  colors?: ColorVariant[];
  variants?: ProductVariant[];
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
    originalPrice: doc.originalPrice,
    stock: doc.stock,
    image: doc.image,
    hoverImage: doc.hoverImage,
    brand: doc.brand,
    sizes: doc.sizes,
    colors: doc.colors,
    variants: doc.variants,
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

/**
 * One product, served off the same cached list rather than its own query.
 *
 * The catalog is small and already resident, so a findOne here would be a
 * second Atlas round trip for data we are holding in memory — and it would
 * miss the request-collapsing that makes the list cheap under load. If the
 * catalog ever grows past what's sensible to keep in memory, this is the
 * seam to swap for a keyed cache over `findOne({ _id: id })`.
 */
export async function getPublicProductById(
  id: string,
): Promise<PublicProduct | null> {
  const all = await getPublicProducts();
  return all.find((p) => p.id === id) ?? null;
}

// The admin inventory list is the same collection read, but it cannot be
// served off `publicProductsCache`: `toPublicProduct` drops the fields the
// admin screens need (timestamps, and the raw `_id`/`name` distinction the
// edit form round-trips). So it gets its own cache over the raw documents.
//
// The TTL is shorter than the storefront's because the audience is
// different. A shopper seeing 15-second-old stock is fine; an admin who
// just saved an edit expects the list to reflect it. Invalidation — not
// this TTL — is what actually delivers that: `invalidateProductCaches`
// clears this cache on every write, so the number below only bounds how
// long a *second* container can lag behind a write it didn't serve.
const ADMIN_PRODUCTS_TTL_MS = 10_000;
const adminProductsCache = createTTLCache<ProductDoc[]>(ADMIN_PRODUCTS_TTL_MS);

/**
 * Full product documents for the admin screens, cached per container.
 *
 * Read this from Server Components instead of having the client fetch
 * `/api/admin/products`: the route handler costs a second request whose
 * `requireAdmin` does its own `findOne`, so a client-side fetch turns one
 * navigation into three Atlas round trips where a server read makes two.
 */
export async function getAdminProducts(): Promise<ProductDoc[]> {
  return adminProductsCache.get(async () => {
    const products = await getProductsCollection();
    return products.find().sort({ _id: 1 }).toArray();
  });
}

/** Call after any write that changes product data or stock, so the
 * storefront doesn't serve a stale cached list until the TTL expires.
 *
 * Prefer `invalidateProductCaches` from lib/revalidate.ts at route-handler
 * call sites — it clears the rendered pages as well as this list. */
export function invalidatePublicProductsCache() {
  publicProductsCache.invalidate();
  // The admin list is cleared here rather than in its own exported
  // function so there is exactly one thing to call after a write. Missing
  // this is how an admin saves an edit and watches the list not change.
  adminProductsCache.invalidate();
}

/** Cache state for both product caches, for scripts/check-cache.ts. */
export function peekProductCaches() {
  return {
    public: publicProductsCache.peek(),
    admin: adminProductsCache.peek(),
  };
}
