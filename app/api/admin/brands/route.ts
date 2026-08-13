import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getAdminBrands, getBrandsCollection } from "@/lib/models/brand";
import { invalidateBrandCaches } from "@/lib/revalidate";
import { NO_STORE_CACHE_HEADERS } from "@/lib/httpCache";
import { ObjectId } from "mongodb";
import { escapeRegex } from "@/lib/validation";
import { recordAudit } from "@/lib/models/auditLog";
import { getClientIp } from "@/lib/rateLimit";

/**
 * Still here after the brands screen moved to server rendering, because
 * the product forms populate their brand dropdown from it. Serving it off
 * `getAdminBrands` means opening the new/edit product form is a cache hit
 * rather than another Atlas query.
 *
 * `no-store` is set explicitly even though next.config.ts already blankets
 * `/api/admin/*` with it — the config is the backstop, and a route that
 * states its own caching contract doesn't silently depend on it.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin)
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: NO_STORE_CACHE_HEADERS },
    );

  try {
    const brands = await getAdminBrands();
    return NextResponse.json(brands, { headers: NO_STORE_CACHE_HEADERS });
  } catch (error) {
    console.error("Error fetching brands:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500, headers: NO_STORE_CACHE_HEADERS },
    );
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { name } = await req.json();

    if (!name || typeof name !== "string" || name.trim() === "") {
      return NextResponse.json(
        { error: "Brand name is required." },
        { status: 400 }
      );
    }

    const trimmedName = name.trim();
    const brands = await getBrandsCollection();

    // The name is escaped before it becomes a pattern. Unescaped, a brand
    // like "C++ (Pro)" throws a SyntaxError (surfacing as a 500) and a
    // crafted one is a ReDoS.
    const existing = await brands.findOne({
      name: { $regex: `^${escapeRegex(trimmedName)}$`, $options: "i" },
    });

    if (existing) {
      return NextResponse.json(
        { error: "A brand with that name already exists." },
        { status: 409 }
      );
    }

    const now = new Date();
    const result = await brands.insertOne({
      _id: new ObjectId(),
      name: trimmedName,
      createdAt: now,
      updatedAt: now,
    });

    invalidateBrandCaches();

    await recordAudit({
      admin,
      action: "brand.create",
      targetType: "brand",
      targetId: result.insertedId.toString(),
      targetLabel: trimmedName,
      ip: getClientIp(req),
    });

    return NextResponse.json({
      success: true,
      brand: { id: result.insertedId.toString(), name: trimmedName },
    });
  } catch (error) {
    console.error("Error creating brand:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
