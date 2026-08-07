import { NextResponse } from "next/server";
import { getPublicBrands } from "@/lib/models/brand";
import { PUBLIC_READ_CACHE_HEADERS } from "@/lib/httpCache";

/**
 * Public brand listing. Same shape and same caching rationale as
 * /api/products — no per-user data, so it is safe to cache at the edge.
 */
export async function GET() {
  try {
    const allBrands = await getPublicBrands();
    return NextResponse.json(allBrands, { headers: PUBLIC_READ_CACHE_HEADERS });
  } catch (error) {
    console.error("Error fetching brands:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
