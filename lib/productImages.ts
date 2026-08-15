import type { ColorVariant, ProductVariant } from "@/lib/models/product";

/**
 * Photo resolution for a colour/size selection.
 *
 * This lives in its own module rather than beside the schema because it is
 * the one piece of that file the browser needs. `lib/models/product.ts`
 * imports `getDb`, so a client component doing a value import from it
 * drags the MongoDB driver — and its Node built-ins — into the client
 * bundle. Type-only imports are erased and stay safe; this is not one.
 *
 * Most specific wins: the exact variant's own photo, then the colour's,
 * then the product's. Shared by the storefront, the cart and the admin
 * preview so none of them can disagree about what a selection looks like.
 */
export function resolveVariantImage(
  product: {
    image: string;
    colors?: ColorVariant[];
    variants?: ProductVariant[];
  },
  colorName?: string,
  size?: string,
): string {
  const variant = product.variants?.find(
    (v) =>
      (v.color ?? undefined) === (colorName ?? undefined) &&
      (v.size ?? undefined) === (size ?? undefined),
  );
  if (variant?.image) return variant.image;

  const color = product.colors?.find((c) => c.name === colorName);
  if (color?.image) return color.image;

  return product.image;
}

/**
 * The second photo for a colour/size selection, shown on hover.
 *
 * Same chain as `resolveVariantImage` and deliberately independent of it: the
 * two are resolved separately rather than as a pair, so a variant that has
 * its own main photo but no hover still gets *a* hover from the colour
 * instead of losing the behaviour entirely.
 *
 * Returns undefined when nothing anywhere has a hover photo, which callers
 * read as "no hover swap" rather than as an error — unlike the main photo,
 * there is no product-level guarantee that one exists.
 */
export function resolveVariantHoverImage(
  product: {
    hoverImage?: string;
    colors?: ColorVariant[];
    variants?: ProductVariant[];
  },
  colorName?: string,
  size?: string,
): string | undefined {
  const variant = product.variants?.find(
    (v) =>
      (v.color ?? undefined) === (colorName ?? undefined) &&
      (v.size ?? undefined) === (size ?? undefined),
  );
  if (variant?.hoverImage) return variant.hoverImage;

  const color = product.colors?.find((c) => c.name === colorName);
  if (color?.hoverImage) return color.hoverImage;

  return product.hoverImage;
}
