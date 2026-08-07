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

  return (
    <Link
      href={`/product/${product.id}`}
      className="group flex flex-col min-h-[420px] bg-surface rounded-2xl border border-border overflow-hidden card-hover"
    >
      <div className="aspect-[3/4] w-full relative bg-zinc-50 flex items-center justify-center overflow-hidden">
        {product.featured && (
          <div className="absolute top-3 left-3 z-10 bg-white/90 backdrop-blur text-zinc-900 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-md shadow-sm">
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
          <ShoppingBag className="w-14 h-14 text-zinc-300 group-hover:scale-105 group-hover:text-zinc-400 transition-all duration-500" />
        )}
      </div>

      <div className="p-5 flex flex-col flex-grow">
        {product.brand && (
          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wide mb-1">
            {product.brand}
          </span>
        )}
        <div className="flex justify-between items-start gap-3 mb-2">
          <h2 className="text-base font-medium text-zinc-900 leading-tight">
            {product.name}
          </h2>
          <span className="text-zinc-900 font-semibold text-sm whitespace-nowrap">
            ₱{product.price.toFixed(2)}
          </span>
        </div>

        <p className="text-zinc-500 text-sm mb-3 flex-grow">
          {product.description}
        </p>

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
                  className={`w-5 h-5 rounded-full border-2 transition-colors ${
                    isSelected
                      ? "border-zinc-900"
                      : "border-transparent hover:border-zinc-300"
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
          disabled={product.stock <= 0}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAddToCart(product, selectedColor?.name);
          }}
          className="w-full flex items-center justify-center gap-2 bg-zinc-900 text-white py-2.5 rounded-xl font-medium text-sm hover:bg-zinc-700 transition-all duration-300 transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900 disabled:active:scale-100"
        >
          <Plus className="w-4 h-4" />
          {product.stock <= 0 ? "Out of stock" : "Add to cart"}
        </button>
      </div>
    </Link>
  );
}
