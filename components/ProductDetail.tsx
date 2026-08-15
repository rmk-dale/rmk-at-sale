"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useCartStore } from "@/lib/store";
import { MAX_QUANTITY_PER_LINE } from "@/lib/validation";
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

  const defaultColor =
    product.colors?.find((c) => c.isDefault) ?? product.colors?.[0] ?? null;

  const [selectedColor, setSelectedColor] = useState<ColorVariant | null>(
    defaultColor,
  );
  // Deliberately null. Defaulting to sizes[0] meant a shopper who never
  // looked at the size row still got one on their order, at a price they
  // had not seen.
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
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
  const displayOriginalPrice =
    activeVariant?.originalPrice ?? product.originalPrice;
  const displayStock = activeVariant ? activeVariant.stock : product.stock;

  const heroImage =
    activeVariant?.image || selectedColor?.image || product.image;

  const canAdd = sizeChosen && variantResolved && displayStock > 0;
  const maxQuantity = Math.max(1, Math.min(displayStock, MAX_QUANTITY_PER_LINE));
  const effectiveQuantity = Math.min(quantity, maxQuantity);

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

  const buttonLabel = !sizeChosen
    ? "Select a size"
    : !variantResolved
      ? "Unavailable"
      : displayStock <= 0
        ? "Out of stock"
        : added
          ? "Added to cart"
          : `Add to cart · ₱${(displayPrice * effectiveQuantity).toFixed(2)}`;

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
          <ProductGallery
            name={product.name}
            hero={heroImage}
            thumbnails={[
              activeVariant?.image,
              selectedColor?.image || product.image,
              selectedColor?.hoverImage || product.hoverImage,
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

              <button
                disabled={!canAdd}
                onClick={handleAddToCart}
                className={buttonClass}
              >
                {buttonLabel}
              </button>
            </div>
          </div>
        </div>

        {/* Zone C — reference material, below the decision. */}
        {product.description && (
          <div className="mt-12 max-w-2xl">
            <h2 className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">
              Details
            </h2>
            <p className="text-foreground leading-relaxed">
              {product.description}
            </p>
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
