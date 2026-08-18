"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useCartStore } from "@/lib/store";
import { useHydrated } from "@/lib/useHydrated";
import {
  BUNDLE_SIZE,
  MAX_QUANTITY_PER_LINE,
  MIN_UNITS_PER_PRODUCT,
} from "@/lib/validation";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import ColorSelector from "@/components/ColorSelector";
import SizeSelector from "@/components/SizeSelector";
import ProductGallery from "@/components/ProductGallery";
import type { ColorVariant, PublicProduct } from "@/lib/models/product";

/** Below this, a variant is worth calling out rather than just "in stock". */
const LOW_STOCK_THRESHOLD = 5;

/**
 * Interactive half of the product page.
 *
 * The product is resolved on the server and passed in, so colour, size and
 * quantity state can be initialised correctly on the first render instead
 * of being corrected by an effect once a fetch resolves.
 *
 * The layout is three zones: identity on the page background, the buy box
 * as the only card, and the description below. Previously all of it shared
 * one card and one spacing rhythm, with the description sitting between
 * the price and the controls — so the decision a shopper came to make was
 * pushed toward the fold and nothing marked it as required.
 */
export default function ProductDetail({ product }: { product: PublicProduct }) {
  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);
  const cartItems = useCartStore((state) => state.items);

  /*
    The cart lives in localStorage, which the server render has no view of.
    Anything derived from it has to wait for hydration or React reports a
    mismatch — so the quantity default below, which depends only on the
    product, is set directly, while the "you'll have N in your cart" line
    is held back until this flips.
  */
  const cartReady = useHydrated();

  const defaultColor =
    product.colors?.find((c) => c.isDefault) ?? product.colors?.[0] ?? null;

  const [selectedColor, setSelectedColor] = useState<ColorVariant | null>(
    defaultColor,
  );
  // Deliberately null. Defaulting to sizes[0] meant a shopper who never
  // looked at the size row still got one on their order, at a price they
  // had not seen.
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  /*
    Starts at the minimum, not at 1.

    The stepper still goes down to 1, and deliberately so: the minimum is
    per product, not per line, so one 55cm and one 67cm is a perfectly
    legal way to reach it. Clamping the floor to 2 would make that mixing
    impossible — the shopper would be forced to two of a single size. The
    default just makes the common path the effortless one.
  */
  const [quantity, setQuantity] = useState(MIN_UNITS_PER_PRODUCT);
  const [added, setAdded] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(true);

  const ctaRef = useRef<HTMLDivElement>(null);

  // The sticky bar exists to bring the CTA back once the real one has
  // scrolled away; while it is on screen the bar would be a duplicate.
  useEffect(() => {
    const node = ctaRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setCtaVisible(entry.isIntersecting),
      { rootMargin: "-80px 0px 0px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const hasSizes = (product.sizes?.length ?? 0) > 0;
  const hasVariants = (product.variants?.length ?? 0) > 0;
  const sizeChosen = !hasSizes || selectedSize !== null;

  const activeVariant = product.variants?.find(
    (v) =>
      (v.color ?? undefined) === (selectedColor?.name ?? undefined) &&
      (v.size ?? undefined) === (selectedSize ?? undefined),
  );

  // With a matrix present, the matrix is the source of truth. Falling back
  // to the base fields hid a renamed colour behind a plausible price.
  const variantResolved = !hasVariants || !!activeVariant;
  const displayPrice = activeVariant ? activeVariant.price : product.price;
  // No `?? product.originalPrice` here. A variant with no original price is
  // simply not on sale, and `product.originalPrice` is an aggregate — the
  // admin form derives it as the max across whichever variants have one
  // (ProductForm computedOriginalPrice). Falling back to it meant one
  // discounted cell painted a strike-through and a −X% ribbon onto every
  // other size and colour, and rode into the cart line below.
  // Same rule as price: with a matrix present, the matrix decides.
  const displayOriginalPrice = hasVariants
    ? activeVariant?.originalPrice
    : product.originalPrice;
  const displayStock = activeVariant ? activeVariant.stock : product.stock;

  /*
    Resolved from `activeVariant` directly rather than through
    `resolveVariantImage`, even though that helper implements the same chain.
    The helper re-finds the variant by colour and size; this component already
    holds the one it resolved for price and stock, and reading the photo off a
    *different* lookup is how a page ends up quoting one variant's price beside
    another variant's photograph. One lookup, one variant, everything on screen
    describes the same cell.

    The two photos are resolved independently, not as a pair: a variant with
    its own main shot but no second shot still borrows the colour's second
    shot, rather than losing the hover behaviour altogether.
  */
  const heroImage =
    activeVariant?.image || selectedColor?.image || product.image;
  const heroHoverImage =
    activeVariant?.hoverImage ||
    selectedColor?.hoverImage ||
    product.hoverImage;

  /*
    Every unit of this product that exists, across every colour and size.

    The minimum is per product and can be met by mixing variants, so the
    question "can this be bought at all?" is not about the selected cell —
    a shopper looking at the last 55cm can still reach two by taking a
    67cm. Only when the whole matrix holds fewer than the minimum is the
    product genuinely unbuyable, and saying so here is better than letting
    someone assemble a cart that checkout is guaranteed to reject.
  */
  const productTotalStock = hasVariants
    ? product.variants!.reduce((sum, v) => sum + Math.max(0, v.stock), 0)
    : product.stock;
  const enoughStockForMinimum = productTotalStock >= MIN_UNITS_PER_PRODUCT;

  const canAdd =
    sizeChosen && variantResolved && displayStock > 0 && enoughStockForMinimum;
  const maxQuantity = Math.max(1, Math.min(displayStock, MAX_QUANTITY_PER_LINE));
  const effectiveQuantity = Math.min(quantity, maxQuantity);

  // What this product's group will hold once this add lands. The cart may
  // already carry other sizes or colours of it, and they all count.
  const inCartQuantity = cartItems.reduce(
    (sum, line) => (line.id === product.id ? sum + line.quantity : sum),
    0,
  );
  const projectedQuantity = inCartQuantity + effectiveQuantity;

  const discount =
    displayOriginalPrice && displayOriginalPrice > displayPrice
      ? Math.round((1 - displayPrice / displayOriginalPrice) * 100)
      : 0;

  const handleAddToCart = () => {
    if (!canAdd) return;
    addItem({
      id: product.id,
      name: product.name,
      price: displayPrice,
      originalPrice: displayOriginalPrice,
      image: heroImage,
      quantity: effectiveQuantity,
      color: selectedColor?.name,
      size: selectedSize || undefined,
      variantStock: displayStock,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  const buttonLabel = !enoughStockForMinimum
    ? "Not enough stock"
    : !sizeChosen
      ? "Select a size"
      : !variantResolved
        ? "Unavailable"
        : displayStock <= 0
          ? "Out of stock"
          : added
            ? "Added to cart"
            : `Add to cart · ₱${(displayPrice * effectiveQuantity).toFixed(2)}`;

  /*
    One line under the CTA, describing where this add leaves the product's
    group. Only the states a shopper can act on are worth a sentence — a
    group already past three has nothing useful to be told, since the
    discount is earned at exactly three and the cart does not ask anyone to
    buy less.
  */
  const bundleHint =
    !cartReady || !canAdd
      ? null
      : projectedQuantity < MIN_UNITS_PER_PRODUCT
        ? `Minimum ${MIN_UNITS_PER_PRODUCT} pieces per item — you can mix sizes and colours.`
        : projectedQuantity === BUNDLE_SIZE
          ? `That makes a ${BUNDLE_SIZE}-piece bundle — 5% off this item.`
          : projectedQuantity < BUNDLE_SIZE
            ? `Take ${BUNDLE_SIZE - projectedQuantity} more of this item for a ${BUNDLE_SIZE}-piece bundle and 5% off.`
            : null;

  const buttonClass =
    "w-full bg-primary text-white py-3.5 rounded-xl font-medium hover:bg-primary-hover transition-all transform active:scale-95 motion-reduce:transform-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary disabled:active:scale-100";

  return (
    <>
      <div className="max-w-6xl mx-auto px-6 py-8 pb-28 lg:pb-8">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to shop
        </button>

        <div className="grid lg:grid-cols-2 gap-10 items-start">
          {/*
            Most-specific-first, and every entry the hero can show is present:
            the hover photo is only a hover on a pointer device, so the rail is
            what makes it reachable by tap and by keyboard. The gallery drops
            duplicates and keeps the first label given for each file.
          */}
          <ProductGallery
            name={product.name}
            hero={heroImage}
            heroHover={heroHoverImage}
            thumbnails={[
              {
                src: activeVariant?.image,
                label: selectedSize
                  ? `${selectedSize} — main photo`
                  : "Main photo",
              },
              {
                src: activeVariant?.hoverImage,
                label: selectedSize
                  ? `${selectedSize} — second photo`
                  : "Second photo",
              },
              {
                src: selectedColor?.image || product.image,
                label: selectedColor
                  ? `${selectedColor.name} — main photo`
                  : "Main photo",
              },
              {
                src: selectedColor?.hoverImage || product.hoverImage,
                label: selectedColor
                  ? `${selectedColor.name} — second photo`
                  : "Second photo",
              },
            ]}
          />

          <div>
            {/* Zone A — identity. No card: the buy box below is the only
                surface on the page, so the eye lands on it. */}
            <div className="mb-6">
              {product.brand && (
                <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
                  {product.brand}
                </p>
              )}
              <h1 className="text-3xl font-semibold text-foreground leading-tight mb-3">
                {product.name}
              </h1>

              <div className="flex items-center gap-3 flex-wrap">
                {discount > 0 && (
                  /* The campaign's ribbon, reused. Beacon is a fill
                     carrying Ink at 11.6:1 — never the other way round. */
                  <span className="ribbon-tag bg-beacon text-foreground text-[11px] font-extrabold uppercase tracking-wider pl-2.5 pr-4 py-1.5">
                    −{discount}%
                  </span>
                )}
                {displayOriginalPrice && displayOriginalPrice > displayPrice && (
                  <span className="text-lg font-medium text-muted line-through tabular-nums">
                    ₱{displayOriginalPrice.toFixed(2)}
                  </span>
                )}
                <span className="text-3xl font-semibold text-primary tabular-nums">
                  ₱{displayPrice.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Zone B — the buy box. Ordered by dependency: colour narrows
                the sizes, size resolves the price, price and stock bound
                the quantity, then the commit. */}
            <div
              ref={ctaRef}
              className="bg-surface border border-border rounded-2xl p-6 space-y-6"
            >
              {product.colors && product.colors.length > 0 && (
                <ColorSelector
                  colors={product.colors}
                  variants={product.variants}
                  selected={selectedColor}
                  onSelect={(color) => {
                    setSelectedColor(color);
                    // The chosen size may not exist, or may be sold out, in
                    // the new colour. Clearing is honest; silently keeping
                    // it would resolve to a different variant than the one
                    // the shopper was looking at.
                    setSelectedSize(null);
                  }}
                />
              )}

              {hasSizes && (
                <SizeSelector
                  sizes={product.sizes!}
                  variants={product.variants}
                  colorName={selectedColor?.name}
                  fallbackImage={selectedColor?.image || product.image}
                  selected={selectedSize}
                  onSelect={setSelectedSize}
                />
              )}

              <div className="text-sm">
                {!sizeChosen ? (
                  <span className="text-muted">
                    Pick a size to see availability.
                  </span>
                ) : !variantResolved ? (
                  <span className="text-muted">
                    This combination isn&apos;t available.
                  </span>
                ) : displayStock <= 0 ? (
                  <span className="flex items-center gap-1.5 text-muted">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted" />
                    Out of stock — try another size
                  </span>
                ) : displayStock <= LOW_STOCK_THRESHOLD ? (
                  <span className="flex items-center gap-1.5 text-primary font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                    Only {displayStock} left
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-emerald-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                    In stock
                  </span>
                )}
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-xs font-semibold text-muted uppercase tracking-wide">
                  Quantity
                </span>
                <div className="flex items-center gap-4 bg-background rounded-full px-4 py-2 border border-border">
                  <button
                    onClick={() => setQuantity(Math.max(1, effectiveQuantity - 1))}
                    disabled={effectiveQuantity <= 1}
                    aria-label="Decrease quantity"
                    className="p-1 text-muted hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-muted"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-5 text-center font-medium text-foreground tabular-nums">
                    {effectiveQuantity}
                  </span>
                  <button
                    onClick={() =>
                      setQuantity(Math.min(maxQuantity, effectiveQuantity + 1))
                    }
                    disabled={effectiveQuantity >= maxQuantity}
                    aria-label="Increase quantity"
                    className="p-1 text-muted hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-muted"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                {canAdd && effectiveQuantity >= maxQuantity && (
                  <span className="text-xs text-muted">
                    {displayStock <= MAX_QUANTITY_PER_LINE
                      ? `Only ${displayStock} available`
                      : `Max ${MAX_QUANTITY_PER_LINE} per item`}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <button
                  disabled={!canAdd}
                  onClick={handleAddToCart}
                  className={buttonClass}
                >
                  {buttonLabel}
                </button>

                {!enoughStockForMinimum ? (
                  <p className="text-xs text-muted leading-relaxed">
                    {productTotalStock <= 0
                      ? "This item is sold out."
                      : `Only ${productTotalStock} left across every size and colour, and items are sold ${MIN_UNITS_PER_PRODUCT} at a time.`}
                  </p>
                ) : bundleHint ? (
                  <p
                    className={`text-xs leading-relaxed ${
                      projectedQuantity === BUNDLE_SIZE
                        ? "text-emerald-700 font-medium"
                        : "text-muted"
                    }`}
                  >
                    {bundleHint}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Zone C — reference material, below the decision. */}
        {product.description && (
          <div className="mt-12 max-w-2xl">
            <h2 className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">
              Details
            </h2>
            {/*
              The one place in the app that renders stored markup.

              `dangerouslySetInnerHTML` is doing exactly what its name warns
              about, so the safety has to come from the value: this string
              was sanitized against an allowlist when the admin saved it,
              and sanitized again by `toPublicProduct` on the way out of the
              cache. Rendering anything here that has not been through
              `lib/richText.ts` is a stored-XSS bug — the field is
              admin-writable and shopper-visible, which is the whole shape
              of that vulnerability.

              The `.rich-text` class is what gives headings, lists and
              alignment their appearance back; Tailwind's preflight strips
              them all by default. See app/globals.css.
            */}
            <div
              className="rich-text text-foreground leading-relaxed"
              dangerouslySetInnerHTML={{ __html: product.description }}
            />
          </div>
        )}
      </div>

      {/*
        Mobile sticky bar. On a phone the grid stacks, so the real button
        ends up a full image-height below the fold with no way back to it
        but scrolling. It appears only once that button is out of view.
      */}
      <div
        className={`lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-border px-4 py-3 transition-transform duration-200 motion-reduce:transition-none ${
          ctaVisible ? "translate-y-full" : "translate-y-0"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg overflow-hidden border border-border relative shrink-0 bg-background">
            {heroImage && (
              <Image
                src={heroImage}
                alt=""
                fill
                sizes="44px"
                className="object-cover"
              />
            )}
          </div>
          <button
            disabled={!canAdd}
            onClick={handleAddToCart}
            className={`${buttonClass} py-3`}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </>
  );
}
