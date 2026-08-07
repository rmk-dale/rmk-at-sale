import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import {
  getProductsCollection,
  invalidatePublicProductsCache,
  ColorVariant,
} from "@/lib/models/product";
import { diffFields, recordAudit } from "@/lib/models/auditLog";
import { getClientIp } from "@/lib/rateLimit";

function parseSizes(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const sizes = input.filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );
  return sizes.map((s) => s.trim());
}

function parseColors(input: unknown): ColorVariant[] | null {
  if (!Array.isArray(input)) return null;
  const colors: ColorVariant[] = [];
  for (const entry of input) {
    if (typeof entry !== "object" || entry === null) return null;
    const { name, hex, image, hoverImage, isDefault } = entry as Record<
      string,
      unknown
    >;
    if (typeof name !== "string" || !name.trim()) return null;
    if (typeof image !== "string" || !image) return null;
    colors.push({
      name: name.trim(),
      hex: typeof hex === "string" && hex ? hex : undefined,
      image,
      hoverImage:
        typeof hoverImage === "string" && hoverImage ? hoverImage : undefined,
      isDefault: isDefault === true,
    });
  }
  // Exactly one default: keep the first marked one, or fall back to the
  // first color, so the main display is always unambiguous.
  const firstDefaultIndex = colors.findIndex((c) => c.isDefault);
  const defaultIndex = firstDefaultIndex === -1 ? 0 : firstDefaultIndex;
  return colors.map((c, i) => ({ ...c, isDefault: i === defaultIndex }));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    const { name, description, price, stock, image, hoverImage, brand, sizes, colors, featured } =
      await req.json();

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json(
          { error: "Name cannot be empty." },
          { status: 400 },
        );
      }
      update.name = name;
    }
    if (description !== undefined) {
      if (typeof description !== "string" || !description.trim()) {
        return NextResponse.json(
          { error: "Description cannot be empty." },
          { status: 400 },
        );
      }
      update.description = description;
    }
    if (price !== undefined) {
      if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
        return NextResponse.json(
          { error: "Price must be a non-negative number." },
          { status: 400 },
        );
      }
      update.price = price;
    }
    if (stock !== undefined) {
      if (typeof stock !== "number" || stock < 0 || !Number.isInteger(stock)) {
        return NextResponse.json(
          { error: "Stock must be a non-negative whole number." },
          { status: 400 },
        );
      }
      update.stock = stock;
    }
    if (image !== undefined) {
      if (typeof image !== "string" || !image) {
        return NextResponse.json(
          { error: "Choose a photo for this item." },
          { status: 400 },
        );
      }
      update.image = image;
    }
    if (hoverImage !== undefined) {
      update.hoverImage = hoverImage || undefined;
    }
    if (brand !== undefined) {
      if (typeof brand !== "string") {
        return NextResponse.json(
          { error: "Brand must be text." },
          { status: 400 },
        );
      }
      update.brand = brand.trim() || undefined;
    }
    if (sizes !== undefined) {
      const parsedSizes = parseSizes(sizes);
      if (parsedSizes === null) {
        return NextResponse.json(
          { error: "Sizes must be a list of text values." },
          { status: 400 },
        );
      }
      update.sizes = parsedSizes.length ? parsedSizes : undefined;
    }
    if (colors !== undefined) {
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
      update.colors = parsedColors.length ? parsedColors : undefined;
    }
    if (featured !== undefined) {
      update.featured = Boolean(featured);
    }

    const products = await getProductsCollection();

    // Read before writing so the audit entry can record both sides of
    // every field that moved, and so the price check below compares
    // against the real current value rather than trusting the client.
    const previous = await products.findOne({ _id: id });
    if (!previous) {
      return NextResponse.json(
        { error: `Item ${id} not found.` },
        { status: 404 },
      );
    }

    // Price changes on an existing product are owner-only.
    //
    // Price is the one field with direct financial consequence and the
    // least day-to-day reason for staff to touch, so restricting it is the
    // smallest change that removes the worst outcome of a compromised or
    // careless staff account. Staff keep stock, photos, descriptions,
    // sizes and colours — and can still set a price when creating a new
    // product, where there is no existing value to undercut.
    //
    // Compared against the stored value so that resubmitting the same
    // price (as the edit form does on any save) is not treated as a change.
    if (update.price !== undefined && update.price !== previous.price) {
      if (admin.role !== "owner") {
        return NextResponse.json(
          {
            error:
              "Only an owner can change the price of an existing product. Ask an owner to make this change.",
          },
          { status: 403 },
        );
      }
    }

    const result = await products.findOneAndUpdate(
      { _id: id },
      { $set: update },
      { returnDocument: "after" },
    );

    if (!result) {
      return NextResponse.json(
        { error: `Item ${id} not found.` },
        { status: 404 },
      );
    }

    invalidatePublicProductsCache();

    const changes = diffFields(
      previous as unknown as Record<string, unknown>,
      update,
    );

    // No entry for a save that changed nothing — no-op edits would bury
    // the ones that matter.
    if (changes.length) {
      await recordAudit({
        admin,
        action: "product.update",
        targetType: "product",
        targetId: id,
        targetLabel: previous.name || previous.description,
        changes,
        ip: getClientIp(req),
      });
    }

    return NextResponse.json({ success: true, product: result });
  } catch (error) {
    console.error("Error updating product:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
