import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireAdmin } from "@/lib/adminGuard";
import { getAdminProducts, getProductsCollection } from "@/lib/models/product";
import { parseColors, parseSizes, parseVariants } from "@/lib/productPayload";
import { invalidateProductCaches } from "@/lib/revalidate";
import { NO_STORE_CACHE_HEADERS } from "@/lib/httpCache";
import { recordAudit } from "@/lib/models/auditLog";
import { getClientIp } from "@/lib/rateLimit";

/**
 * The inventory screen reads `getAdminProducts` directly as a Server
 * Component and no longer calls this. It stays for external/API use and
 * shares the same cache, so it can't drift from what the screen shows.
 *
 * `no-store` duplicates the blanket rule in next.config.ts on purpose:
 * the config is a backstop for routes that forget, not a substitute for
 * a route declaring its own contract.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin)
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: NO_STORE_CACHE_HEADERS },
    );

  const all = await getAdminProducts();
  return NextResponse.json(all, { headers: NO_STORE_CACHE_HEADERS });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const {
      name,
      description,
      price,
      originalPrice,
      stock,
      image,
      hoverImage,
      brand,
      sizes,
      colors,
      variants,
      featured,
    } = await req.json();


    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Name is required." },
        { status: 400 },
      );
    }
    if (!description || typeof description !== "string") {
      return NextResponse.json(
        { error: "Description is required." },
        { status: 400 },
      );
    }
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      return NextResponse.json(
        { error: "Price must be a non-negative number." },
        { status: 400 },
      );
    }
    if (originalPrice !== undefined && originalPrice !== null && (typeof originalPrice !== "number" || !Number.isFinite(originalPrice) || originalPrice < 0)) {
      return NextResponse.json(
        { error: "Original price must be a non-negative number." },
        { status: 400 },
      );
    }
    if (typeof stock !== "number" || stock < 0 || !Number.isInteger(stock)) {
      return NextResponse.json(
        { error: "Stock must be a non-negative whole number." },
        { status: 400 },
      );
    }
    if (!image || typeof image !== "string") {
      return NextResponse.json(
        { error: "Choose a photo for this item." },
        { status: 400 },
      );
    }
    if (brand !== undefined && typeof brand !== "string") {
      return NextResponse.json(
        { error: "Brand must be text." },
        { status: 400 },
      );
    }
    const parsedSizes = parseSizes(sizes);
    if (parsedSizes === null) {
      return NextResponse.json(
        { error: "Sizes must be a list of text values." },
        { status: 400 },
      );
    }
    const parsedColors = parseColors(colors);
    if (parsedColors === null) {
      return NextResponse.json(
        {
          error:
            "Each color needs a name and a main photo. Remove any incomplete colors.",
        },
        { status: 400 },
      );
    }
    const parsedVariants = parseVariants(variants);
    if (parsedVariants === null) {
      return NextResponse.json(
        { error: "Variants must have valid price and stock." },
        { status: 400 },
      );
    }

    const newId = new ObjectId().toHexString();
    const products = await getProductsCollection();

    const now = new Date();
    await products.insertOne({
      _id: newId,
      name,
      description,
      price,
      originalPrice,
      stock,
      image,
      hoverImage: hoverImage || undefined,
      brand: brand ? brand.trim() : undefined,
      sizes: parsedSizes.length ? parsedSizes : undefined,
      colors: parsedColors.length ? parsedColors : undefined,
      variants: parsedVariants.length ? parsedVariants : undefined,
      featured: Boolean(featured),
      createdAt: now,
      updatedAt: now,
    });

    invalidateProductCaches(newId);

    await recordAudit({
      admin,
      action: "product.create",
      targetType: "product",
      targetId: newId,
      targetLabel: name,
      changes: [
        { field: "price", from: null, to: price },
        { field: "stock", from: null, to: stock },
      ],
      ip: getClientIp(req),
    });

    return NextResponse.json({ success: true, id: newId });
  } catch (error) {
    console.error("Error adding product:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
