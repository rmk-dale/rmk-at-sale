import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import {
  getBrandsCollection,
  invalidatePublicBrandsCache,
} from "@/lib/models/brand";
import { ObjectId } from "mongodb";
import { getProductsCollection } from "@/lib/models/product";
import { recordAudit } from "@/lib/models/auditLog";
import { getClientIp } from "@/lib/rateLimit";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const resolvedParams = await params;
    const { id } = resolvedParams;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid brand ID" }, { status: 400 });
    }

    const brands = await getBrandsCollection();
    const brand = await brands.findOne({ _id: new ObjectId(id) });

    if (!brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    // Refuse to orphan products.
    //
    // `brand` is stored on the product as a plain string rather than a
    // reference, so deleting the brand document leaves those products
    // pointing at a name that no longer resolves — invisible until someone
    // filters by brand and finds items missing. Blocking the delete forces
    // the reassignment to happen deliberately.
    const products = await getProductsCollection();
    const inUse = await products.countDocuments({ brand: brand.name });

    if (inUse > 0) {
      return NextResponse.json(
        {
          error: `${inUse} product${inUse === 1 ? "" : "s"} still use "${brand.name}". Reassign them to another brand first.`,
          productsAffected: inUse,
        },
        { status: 409 },
      );
    }

    await brands.deleteOne({ _id: brand._id });

    invalidatePublicBrandsCache();

    await recordAudit({
      admin,
      action: "brand.delete",
      targetType: "brand",
      targetId: brand._id.toString(),
      targetLabel: brand.name,
      ip: getClientIp(req),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting brand:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
