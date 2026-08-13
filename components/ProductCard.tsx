"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ShoppingBag, Plus } from "lucide-react";
import type { ColorVariant } from "@/lib/models/product";

export interface CardProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  image: string;
  hoverImage?: string;
  brand?: string;
  sizes?: string[];
  colors?: ColorVariant[];
  variants?: import("@/lib/models/product").ProductVariant[];
  featured?: boolean;
}

interface ProductCardProps {
  product: CardProduct;
  onAddToCart: (product: CardProduct, color?: string, size?: string) => void;
}

export default function ProductCard({
  product,
  onAddToCart,
}: ProductCardProps) {
  const [selectedColor, setSelectedColor] = useState<ColorVariant | null>(
    product.colors?.find((c) => c.isDefault) ?? product.colors?.[0] ?? null,
  );

  const image = selectedColor?.image || product.image;
  const hoverImage = selectedColor?.hoverImage || product.hoverImage;

  // Determine display price
  let minPrice = product.price;
  let maxPrice = product.price;
  if (product.variants && product.variants.length > 0) {
    minPrice = Math.min(...product.variants.map((v) => v.price));
    maxPrice = Math.max(...product.variants.map((v) => v.price));
  }

  // Determine display stock for the selected color (across all sizes)
  let displayStock = product.stock;
  if (product.variants && product.variants.length > 0 && selectedColor) {
    const colorVariants = product.variants.filter(
      (v) => v.color === selectedColor.name
    );
    if (colorVariants.length > 0) {
      displayStock = colorVariants.reduce((sum, v) => sum + v.stock, 0);
    }
  }

  return (
    <Link
      href={`/product/${product.id}`}
      className="group flex flex-col min-h-[420px] bg-surface rounded-2xl border border-border overflow-hidden card-hover"
    >
      <div className="aspect-[3/4] w-full relative bg-background flex items-center justify-center overflow-hidden">
        {/*
          The poster's ribbon, reused as a real component — notched on the
          trailing edge so it butts flush to the image's left edge rather
          than floating as another rounded pill.

          It stays "Featured" rather than "Bundle": the flag is driven by
          `product.featured`, and a featured item is not necessarily part of
          a bundle. Relabelling it would make the badge say something the
          data does not.
        */}
        {product.featured && (
          <div className="ribbon-tag absolute top-3 left-0 z-10 bg-beacon text-foreground text-[10px] font-extrabold uppercase tracking-wider pl-2.5 pr-4 py-1.5">
            Featured
          </div>
        )}
        {image ? (
          <>
            <Image
              src={image}
              alt={product.name}
              fill
              sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
              className={`object-cover transition-opacity duration-500 ${
                hoverImage
                  ? "group-hover:opacity-0"
                  : "group-hover:scale-105"
              }`}
            />
            {hoverImage && (
              <Image
                src={hoverImage}
                alt={`${product.name} detail`}
                fill
                sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100"
              />
            )}
          </>
        ) : (
          <ShoppingBag className="w-14 h-14 text-border group-hover:scale-105 group-hover:text-muted transition-all duration-500" />
        )}
      </div>

      <div className="p-5 flex flex-col flex-grow">
        {product.brand && (
          <span className="text-[11px] font-medium text-muted uppercase tracking-wide mb-1">
            {product.brand}
          </span>
        )}
        <div className="flex justify-between items-start gap-3 mb-2">
          <h2 className="text-base font-medium text-foreground leading-tight">
            {product.name}
          </h2>
          <span className="text-primary font-semibold text-sm whitespace-nowrap tabular-nums">
            {minPrice < maxPrice ? "From " : ""}₱{minPrice.toFixed(2)}
          </span>
        </div>

        <div className="flex-grow" />

        {product.colors && product.colors.length > 0 && (
          <div className="flex items-center gap-1.5 mb-4">
            {product.colors.map((color) => {
              const isSelected = selectedColor?.name === color.name;
              return (
                <button
                  key={color.name}
                  type="button"
                  title={color.name}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedColor(color);
                  }}
                  aria-pressed={isSelected}
                  className={`w-5 h-5 rounded-full border-2 transition-colors ${
                    isSelected
                      ? "border-primary"
                      : "border-transparent hover:border-border"
                  }`}
                >
                  <span
                    className="block w-full h-full rounded-full border border-black/10"
                    style={{ backgroundColor: color.hex || "#d4d4d8" }}
                  />
                </button>
              );
            })}
          </div>
        )}

        <button
          disabled={displayStock <= 0}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAddToCart(product, selectedColor?.name);
          }}
          className="w-full flex items-center justify-center gap-2 bg-primary text-white py-2.5 rounded-xl font-medium text-sm hover:bg-primary-hover transition-all duration-300 transform active:scale-95 motion-reduce:transform-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary disabled:active:scale-100"
        >
          <Plus className="w-4 h-4" />
          {displayStock <= 0 ? "Out of stock" : "Add to cart"}
        </button>
      </div>
    </Link>
  );
}
