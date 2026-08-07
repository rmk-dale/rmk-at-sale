import { NextResponse } from "next/server";
import { getPublicProducts } from "@/lib/models/product";
import { PUBLIC_READ_CACHE_HEADERS } from "@/lib/httpCache";

/**
 * Public product listing.
 *
 * The storefront pages render this data server-side and no longer call
 * this route, so it exists for clients that want the catalog as JSON. It
 * is cached at the CDN (see `PUBLIC_READ_CACHE_HEADERS`) rather than being
 * served from the origin on every request.
 *
 * Nothing here is per-user — no cookies are read and the response is
 * identical for everyone — which is what makes a shared cache safe.
 */
export async function GET() {
  try {
    const all = await getPublicProducts();
    return NextResponse.json(all, { headers: PUBLIC_READ_CACHE_HEADERS });
  } catch (error) {
    console.error("Error fetching products:", error);
    // Deliberately uncached: a 500 must not be held at the edge and
    // replayed to everyone for the next 15 seconds.
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
