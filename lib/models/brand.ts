import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { createTTLCache } from "@/lib/cache";

export interface BrandDoc {
  _id: ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicBrand {
  id: string;
  name: string;
}

export async function getBrandsCollection() {
  const db = await getDb();
  const collection = db.collection<BrandDoc>("brands");
  return collection;
}

export function toPublicBrand(doc: BrandDoc): PublicBrand {
  return {
    id: doc._id.toString(),
    name: doc.name,
  };
}

// Brand list changes only via the admin panel and is read on every
// storefront request — same rationale as the products cache. Longer TTL
// since brands change far less often than stock.
const PUBLIC_BRANDS_TTL_MS = 60_000;
const publicBrandsCache = createTTLCache<PublicBrand[]>(PUBLIC_BRANDS_TTL_MS);

export async function getPublicBrands(): Promise<PublicBrand[]> {
  return publicBrandsCache.get(async () => {
    const brands = await getBrandsCollection();
    const allBrands = await brands.find().sort({ name: 1 }).toArray();
    return allBrands.map(toPublicBrand);
  });
}

// The admin brands screen shows the same two fields but ordered by
// recency, so a newly added brand appears at the top rather than wherever
// the alphabet puts it. That is a different sort, not a different query
// shape, so it gets its own small cache rather than re-sorting the public
// one — keeping the two independent means changing either screen's order
// later can't silently reorder the other.
const ADMIN_BRANDS_TTL_MS = 10_000;
const adminBrandsCache = createTTLCache<PublicBrand[]>(ADMIN_BRANDS_TTL_MS);

/**
 * Brands for the admin screen, newest first, cached per container.
 *
 * As with `getAdminProducts`, read this from a Server Component rather
 * than fetching `/api/admin/brands` from the client — the round trip costs
 * an extra `requireAdmin` lookup on top of the query itself.
 */
export async function getAdminBrands(): Promise<PublicBrand[]> {
  return adminBrandsCache.get(async () => {
    const brands = await getBrandsCollection();
    const allBrands = await brands.find().sort({ createdAt: -1 }).toArray();
    return allBrands.map(toPublicBrand);
  });
}

/** Call after any write that adds/removes/renames a brand.
 *
 * Prefer `invalidateBrandCaches` from lib/revalidate.ts at route-handler
 * call sites — it clears the rendered storefront as well as this list. */
export function invalidatePublicBrandsCache() {
  publicBrandsCache.invalidate();
  // Cleared together with the public list for the same reason the product
  // caches are: one call after a write, no second thing to forget.
  adminBrandsCache.invalidate();
}

/** Cache state for both brand caches, for scripts/check-cache.ts. */
export function peekBrandCaches() {
  return {
    public: publicBrandsCache.peek(),
    admin: adminBrandsCache.peek(),
  };
}
