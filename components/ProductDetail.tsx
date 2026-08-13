"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useCartStore } from "@/lib/store";
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
 */
export default function ProductDetail({ product }: { product: PublicProduct }) {
  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);

  const defaultColor =
    product.colors?.find((c) => c.isDefault) ?? product.colors?.[0] ?? null;

  const [selectedColor, setSelectedColor] = useState<ColorVariant | null>(
    defaultColor,
  );
  const [selectedSize, setSelectedSize] = useState<string | null>(
    product.sizes?.[0] ?? null,
  );
  const [activeImage, setActiveImage] = useState<string | null>(
    defaultColor?.image || product.image || null,
  );
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const thumbnails = [
    selectedColor?.image || product.image,
    selectedColor?.hoverImage || product.hoverImage,
  ].filter(Boolean) as string[];

  const activeVariant = product.variants?.find(
    (v) =>
      (v.color === selectedColor?.name || (!v.color && !selectedColor)) &&
      (v.size === selectedSize || (!v.size && !selectedSize))
  );

  const displayPrice = activeVariant ? activeVariant.price : product.price;
  const displayStock = activeVariant ? activeVariant.stock : product.stock;

  const handleAddToCart = () => {
    for (let i = 0; i < quantity; i++) {
      addItem({
        id: product.id,
        name: product.name,
        price: displayPrice,
        image: selectedColor?.image || product.image,
        quantity: 1,
        color: selectedColor?.name,
        size: selectedSize || undefined,
      });
    }
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

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
              <p className="text-sm font-medium text-foreground mb-3">Size</p>
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
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                aria-label="Decrease quantity"
                className="p-1 text-muted hover:text-primary transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-4 text-center font-medium text-foreground tabular-nums">
                {quantity}
              </span>
              <button
                onClick={() => setQuantity((q) => q + 1)}
                aria-label="Increase quantity"
                className="p-1 text-muted hover:text-primary transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <button
            disabled={displayStock <= 0}
            onClick={handleAddToCart}
            className="w-full bg-primary text-white py-3.5 rounded-xl font-medium hover:bg-primary-hover transition-all transform active:scale-95 motion-reduce:transform-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary disabled:active:scale-100"
          >
            {displayStock <= 0
              ? "Out of stock"
              : added
                ? "Added to cart"
                : "Add to cart"}
          </button>
        </div>
      </div>
    </div>
  );
}
