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

/** Call after any write that adds/removes/renames a brand.
 *
 * Prefer `invalidateBrandCaches` from lib/revalidate.ts at route-handler
 * call sites — it clears the rendered storefront as well as this list. */
export function invalidatePublicBrandsCache() {
  publicBrandsCache.invalidate();
}
