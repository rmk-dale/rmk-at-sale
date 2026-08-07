import { getPublicProducts } from "@/lib/models/product";
import { getPublicBrands } from "@/lib/models/brand";
import CatalogBrowser from "@/components/CatalogBrowser";

/**
 * Storefront listing — a server component.
 *
 * Reads go straight to the model layer rather than back through
 * `/api/products`, so a page view costs no HTTP round trip and hits the
 * same in-memory TTL cache the API route uses.
 *
 * `revalidate` makes this ISR: the rendered HTML is stored and reused for
 * 15 seconds, and Vercel translates it into `s-maxage=15` so a CDN edge
 * can serve it without waking the origin at all. Writes call
 * `invalidateProductCaches` / `invalidateBrandCaches` (lib/revalidate.ts),
 * which clears this cache immediately rather than waiting out the window.
 *
 * Must stay a literal — Next reads it by static analysis and rejects an
 * imported constant. See PUBLIC_READ_MAX_AGE_SECONDS in lib/httpCache.ts.
 */
export const revalidate = 15;

export default async function Home() {
  // Issued together: neither read depends on the other, so serialising
  // them would add a full round trip to every cold render.
  const [products, brands] = await Promise.all([
    getPublicProducts(),
    getPublicBrands(),
  ]);

  return <CatalogBrowser products={products} brands={brands} />;
}
