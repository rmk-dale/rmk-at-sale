"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useCartStore } from "@/lib/store";
import { MAX_QUANTITY_PER_LINE } from "@/lib/validation";
import { ArrowLeft, Check, Minus, Plus, ShoppingBag } from "lucide-react";
import type { ColorVariant, PublicProduct } from "@/lib/models/product";

function isLightColor(hex?: string): boolean {
  if (!hex) return true;
  const value = hex.replace("#", "");
  if (value.length !== 6) return true;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}

/**
 * Interactive half of the product page.
 *
 * The product is resolved on the server and passed in, so colour, size and
 * quantity state can be initialised correctly on the first render instead
 * of being corrected by an effect once a fetch resolves.
 *
 * The colour and size chosen here are the sole basis for the cart line:
 * they resolve to exactly one ProductVariant, and that variant supplies
 * the price, the original price and the stock ceiling. There is no path
 * from this page to the cart that reads `product.price` — that field is
 * `min(variants.price)` and is only meaningful as a "From ₱X" display
 * value on the listing.
 */
export default function ProductDetail({ product }: { product: PublicProduct }) {
  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);

  const defaultColor =
    product.colors?.find((c) => c.isDefault) ?? product.colors?.[0] ?? null;

  const [selectedColor, setSelectedColor] = useState<ColorVariant | null>(
    defaultColor,
  );
  /*
    Deliberately null, even when the product has sizes.

    This used to default to `sizes[0]`, so a shopper who never looked at
    the size row still got a size on their order — at that size's price,
    which they had never seen, and possibly with no stock behind it. A
    size is a decision, so it has to be made rather than inherited.
  */
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState<string | null>(
    defaultColor?.image || product.image || null,
  );
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const thumbnails = [
    selectedColor?.image || product.image,
    selectedColor?.hoverImage || product.hoverImage,
  ].filter(Boolean) as string[];

  const hasSizes = (product.sizes?.length ?? 0) > 0;
  const hasVariants = (product.variants?.length ?? 0) > 0;
  const sizeChosen = !hasSizes || selectedSize !== null;

  const activeVariant = product.variants?.find(
    (v) =>
      (v.color ?? undefined) === (selectedColor?.name ?? undefined) &&
      (v.size ?? undefined) === (selectedSize ?? undefined),
  );

  /*
    When a product has a variant matrix, that matrix is the source of
    truth — falling back to the base fields hides the failure. A colour
    renamed without regenerating the matrix used to leave `activeVariant`
    undefined, at which point the page quoted `product.price` for a
    combination that does not exist and let it be added anyway.
  */
  const variantResolved = !hasVariants || !!activeVariant;
  const displayPrice = activeVariant ? activeVariant.price : product.price;
  const displayOriginalPrice =
    activeVariant?.originalPrice ?? product.originalPrice;
  const displayStock = activeVariant ? activeVariant.stock : product.stock;

  const canAdd = sizeChosen && variantResolved && displayStock > 0;
  // The stepper stops where the shopper's order would stop being fillable.
  // MAX_QUANTITY_PER_LINE is the same limit /api/checkout enforces, so the
  // ceiling is no longer discovered on the last screen.
  const maxQuantity = Math.max(
    1,
    Math.min(displayStock, MAX_QUANTITY_PER_LINE),
  );
  // Derived rather than clamped in state: switching to a size with less
  // stock lowers the effective figure without stranding the shopper's
  // original intent if they switch back.
  const effectiveQuantity = Math.min(quantity, maxQuantity);

  const handleAddToCart = () => {
    if (!canAdd) return;
    // Once, with the real quantity. This used to loop `quantity` times,
    // because the store ignored the quantity it was handed.
    addItem({
      id: product.id,
      name: product.name,
      price: displayPrice,
      originalPrice: displayOriginalPrice,
      image: selectedColor?.image || product.image,
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
          : "Add to cart";

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to shop
      </button>

      <div className="grid lg:grid-cols-2 gap-10">
        {/* Image */}
        <div>
          <div className="aspect-[4/5] w-full relative bg-surface rounded-2xl border border-border overflow-hidden flex items-center justify-center">
            {activeImage ? (
              <Image
                src={activeImage}
                alt={product.name}
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover"
                priority
              />
            ) : (
              <ShoppingBag className="w-20 h-20 text-border" />
            )}
          </div>

          {thumbnails.length > 1 && (
            <div className="flex gap-3 mt-4">
              {thumbnails.map((thumb) => (
                <button
                  key={thumb}
                  onClick={() => setActiveImage(thumb)}
                  className={`w-16 h-16 rounded-xl overflow-hidden border relative transition-colors ${
                    activeImage === thumb
                      ? "border-primary"
                      : "border-border hover:border-muted"
                  }`}
                  aria-current={activeImage === thumb}
                >
                  <Image
                    src={thumb}
                    alt=""
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="bg-surface border border-border rounded-2xl p-8">
          {product.brand && (
            <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
              {product.brand}
            </p>
          )}
          <h1 className="text-2xl font-semibold text-foreground mb-1">
            {product.name}
          </h1>

          <div className="flex items-center gap-2 mb-6">
            {displayOriginalPrice && displayOriginalPrice > displayPrice && (
              <span className="text-xl font-medium text-muted line-through tabular-nums mr-1">
                ₱{displayOriginalPrice.toFixed(2)}
              </span>
            )}
            <span className="text-2xl font-semibold text-primary tabular-nums">
              ₱{displayPrice.toFixed(2)}
            </span>
            {displayStock > 0 ? (
              <span className="flex items-center gap-1.5 text-sm text-emerald-700 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                Available
              </span>
            ) : (
              /*
                Out-of-stock deliberately does NOT use the palette red. On
                this page the action colour already means "buy this"; if the
                same red also means "you can't", the signal stops carrying
                information. Neutral muted, plus the button below going
                disabled, is the clearer pairing.
              */
              <span className="flex items-center gap-1.5 text-sm text-muted ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-muted" />
                Out of stock
              </span>
            )}
          </div>

          <p className="text-muted leading-relaxed mb-8">
            {product.description}
          </p>

          {product.colors && product.colors.length > 0 && (
            <div className="mb-6">
              <p className="text-sm font-medium text-foreground mb-3">
                Color
                {selectedColor ? (
                  <span className="text-muted font-normal">
                    {" "}
                    — {selectedColor.name}
                  </span>
                ) : null}
              </p>
              <div className="flex items-center gap-3">
                {product.colors.map((color) => {
                  const isSelected = selectedColor?.name === color.name;
                  return (
                    <button
                      key={color.name}
                      type="button"
                      onClick={() => {
                        setSelectedColor(color);
                        setActiveImage(color.image || product.image);
                      }}
                      title={color.name}
                      aria-pressed={isSelected}
                      className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors ${
                        isSelected
                          ? "border-primary"
                          : "border-transparent hover:border-border"
                      }`}
                    >
                      <span
                        className="w-7 h-7 rounded-full border border-black/10 flex items-center justify-center"
                        style={{ backgroundColor: color.hex || "#d4d4d8" }}
                      >
                        {isSelected && (
                          <Check
                            className="w-3.5 h-3.5"
                            style={{
                              color: isLightColor(color.hex)
                                ? "#1c1512"
                                : "#ffffff",
                            }}
                          />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {product.sizes && product.sizes.length > 0 && (
            <div className="mb-6">
              <p className="text-sm font-medium text-foreground mb-3">
                Size
                {!selectedSize && (
                  <span className="text-muted font-normal">
                    {" "}
                    — please choose
                  </span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {product.sizes.map((size) => {
                  const isSelected = selectedSize === size;
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setSelectedSize(size)}
                      aria-pressed={isSelected}
                      className={`px-4 py-2 rounded-full border text-sm font-medium transition-colors ${
                        isSelected
                          ? "border-primary text-primary bg-primary/5"
                          : "border-border text-muted hover:border-muted"
                      }`}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 mb-6">
            <span className="text-sm font-medium text-foreground">Quantity</span>
            <div className="flex items-center gap-4 bg-background rounded-full px-4 py-2 border border-border">
              <button
                onClick={() => setQuantity(Math.max(1, effectiveQuantity - 1))}
                disabled={effectiveQuantity <= 1}
                aria-label="Decrease quantity"
                className="p-1 text-muted hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-muted"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-4 text-center font-medium text-foreground tabular-nums">
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
            className="w-full bg-primary text-white py-3.5 rounded-xl font-medium hover:bg-primary-hover transition-all transform active:scale-95 motion-reduce:transform-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary disabled:active:scale-100"
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
