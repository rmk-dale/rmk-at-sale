import { revalidatePath } from "next/cache";
import { invalidatePublicProductsCache } from "@/lib/models/product";
import { invalidatePublicBrandsCache } from "@/lib/models/brand";

/**
 * Single place that knows every cache layer holding storefront data.
 *
 * There are now three, and a write has to clear all of them or an admin
 * edit appears to do nothing:
 *
 *   1. The in-memory `TTLCache` in the model modules (per container).
 *   2. Next's rendered-page cache — the storefront pages are ISR, so the
 *      HTML is stored and reused independently of the data cache above.
 *   3. The CDN, which honours the `s-maxage` on those pages.
 *
 * (1) and (2) are cleared synchronously here. (3) cannot be purged from
 * application code, so a CDN edge may serve the previous copy for up to
 * its `s-maxage` window (`PUBLIC_READ_MAX_AGE_SECONDS` in lib/httpCache.ts)
 * after a write. That bound is deliberately short, and it is the reason
 * the TTLs are measured in seconds rather than minutes.
 *
 * These must only be called from Route Handlers or Server Functions —
 * `revalidatePath` throws anywhere else.
 */

/**
 * Call after any write touching product data or stock.
 *
 * Pass `productId` when the write was scoped to one product so its detail
 * page is refreshed too; omit it for bulk changes, which fall back to
 * clearing every product page.
 */
export function invalidateProductCaches(productId?: string): void {
  invalidatePublicProductsCache();
  revalidatePath("/");
  if (productId) {
    revalidatePath(`/product/${productId}`);
  } else {
    // Clears every rendered path for the dynamic segment at once.
    revalidatePath("/product/[id]", "page");
  }
}

/** Call after any write that adds, renames, or removes a brand. Brands
 * drive the storefront's filter sidebar, so the listing page is stale too. */
export function invalidateBrandCaches(): void {
  invalidatePublicBrandsCache();
  revalidatePath("/");
}
