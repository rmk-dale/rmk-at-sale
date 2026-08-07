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

  const handleAddToCart = () => {
    for (let i = 0; i < quantity; i++) {
      addItem({
        id: product.id,
        name: product.name,
        price: product.price,
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
        className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to shop
      </button>

      <div className="grid lg:grid-cols-2 gap-10">
        {/* Image */}
        <div>
          <div className="aspect-[4/5] w-full relative bg-zinc-50 rounded-2xl border border-border overflow-hidden flex items-center justify-center">
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
              <ShoppingBag className="w-20 h-20 text-zinc-300" />
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
                      ? "border-zinc-900"
                      : "border-border hover:border-zinc-300"
                  }`}
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
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
              {product.brand}
            </p>
          )}
          <h1 className="text-2xl font-semibold text-zinc-900 mb-1">
            {product.name}
          </h1>

          <div className="flex items-center gap-2 mb-6">
            <span className="text-2xl font-semibold text-zinc-900">
              ₱{product.price.toFixed(2)}
            </span>
            {product.stock > 0 ? (
              <span className="flex items-center gap-1.5 text-sm text-emerald-600 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Available
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-sm text-red-500 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                Out of stock
              </span>
            )}
          </div>

          <p className="text-zinc-600 leading-relaxed mb-8">
            {product.description}
          </p>

          {product.colors && product.colors.length > 0 && (
            <div className="mb-6">
              <p className="text-sm font-medium text-zinc-700 mb-3">
                Color
                {selectedColor ? (
                  <span className="text-zinc-500 font-normal">
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
                      className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors ${
                        isSelected
                          ? "border-zinc-900"
                          : "border-transparent hover:border-zinc-300"
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
                                ? "#18181b"
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
              <p className="text-sm font-medium text-zinc-700 mb-3">Size</p>
              <div className="flex flex-wrap gap-2">
                {product.sizes.map((size) => {
                  const isSelected = selectedSize === size;
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setSelectedSize(size)}
                      className={`px-4 py-2 rounded-full border text-sm font-medium transition-colors ${
                        isSelected
                          ? "border-zinc-900 text-zinc-900"
                          : "border-border text-zinc-600 hover:border-zinc-400"
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
            <span className="text-sm font-medium text-zinc-700">Quantity</span>
            <div className="flex items-center gap-4 bg-zinc-50 rounded-full px-4 py-2 border border-border">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="p-1 text-zinc-600 hover:text-zinc-900 transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-4 text-center font-medium text-zinc-900">
                {quantity}
              </span>
              <button
                onClick={() => setQuantity((q) => q + 1)}
                className="p-1 text-zinc-600 hover:text-zinc-900 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <button
            disabled={product.stock <= 0}
            onClick={handleAddToCart}
            className="w-full bg-zinc-900 text-white py-3.5 rounded-xl font-medium hover:bg-zinc-700 transition-all transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900 disabled:active:scale-100"
          >
            {product.stock <= 0
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
