import type { ColorVariant, ProductVariant } from "@/lib/models/product";

/**
 * Narrowing for the product write payload, shared by POST and PATCH.
 *
 * These three parsers were duplicated verbatim across
 * `app/api/admin/products/route.ts` and `.../[id]/route.ts`. Duplication in a
 * validator is worse than duplication elsewhere: the two copies drifting means
 * one route accepts a shape the other rejects, and the failure surfaces as
 * "saving works on create but not on edit" long after the change that caused
 * it. Adding a field to `ProductVariant` should be one edit, not two.
 *
 * Each returns `null` for "this payload is malformed, reject the request", and
 * a value — possibly empty — for "this is fine". The distinction matters:
 * `[]` means the client explicitly sent nothing, which callers translate to
 * `undefined` so the field is unset rather than stored as an empty array.
 *
 * Every parser tolerates `undefined` by returning `[]`. PATCH guards each call
 * with `if (field !== undefined)` so it never relies on that, but POST does,
 * and a parser that throws on absent input is a trap for the next caller.
 */

export function parseSizes(input: unknown): string[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;
  const sizes = input.filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );
  return sizes.map((s) => s.trim());
}

export function parseColors(input: unknown): ColorVariant[] | null {
  if (input === undefined) return [];
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
  // Exactly one default: keep the first marked one, or fall back to the first
  // color, so the main display is always unambiguous.
  const firstDefaultIndex = colors.findIndex((c) => c.isDefault);
  const defaultIndex = firstDefaultIndex === -1 ? 0 : firstDefaultIndex;
  return colors.map((c, i) => ({ ...c, isDefault: i === defaultIndex }));
}

export function parseVariants(input: unknown): ProductVariant[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;
  const variants: ProductVariant[] = [];
  for (const entry of input) {
    if (typeof entry !== "object" || entry === null) return null;
    const { color, size, price, originalPrice, stock, image, hoverImage } =
      entry as Record<string, unknown>;

    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      return null;
    }
    if (
      originalPrice !== undefined &&
      originalPrice !== null &&
      (typeof originalPrice !== "number" ||
        !Number.isFinite(originalPrice) ||
        originalPrice < 0)
    ) {
      return null;
    }
    if (typeof stock !== "number" || stock < 0 || !Number.isInteger(stock)) {
      return null;
    }

    variants.push({
      color: typeof color === "string" && color.trim() ? color.trim() : undefined,
      size: typeof size === "string" && size.trim() ? size.trim() : undefined,
      price,
      originalPrice:
        originalPrice === null ? undefined : (originalPrice as number | undefined),
      stock,
      // Optional per-combination photos. Narrowed the same way `parseColors`
      // narrows `hoverImage`: a non-string is dropped rather than rejected, so
      // a client that omits it saves a variant without a photo instead of
      // failing the whole write. Both are display-only, which is why a bad
      // value here costs a fallback rather than a 400 — unlike `price` and
      // `stock` above, where a bad value would corrupt an order.
      image: typeof image === "string" && image ? image : undefined,
      hoverImage:
        typeof hoverImage === "string" && hoverImage ? hoverImage : undefined,
    });
  }
  return variants;
}
