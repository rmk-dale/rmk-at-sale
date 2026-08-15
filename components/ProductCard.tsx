"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ShoppingBag, Plus } from "lucide-react";
import type { CartItem } from "@/lib/store";
import type { ColorVariant } from "@/lib/models/product";

export interface CardProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  originalPrice?: number;
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
  /**
   * Receives a fully-resolved cart line, not a product plus loose hints.
   *
   * The card is the only place that knows which colour is selected, so it
   * is the only place that can resolve the variant that selection implies.
   * Handing the caller a half-built line is how this component used to
   * send `size: undefined` and the base product price to the cart.
   */
  onAddToCart: (item: CartItem) => void;
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

  const hasSizes = (product.sizes?.length ?? 0) > 0;
  const hasVariants = (product.variants?.length ?? 0) > 0;

  /**
   * The variants belonging to the swatch currently highlighted.
   *
   * Price and stock below are read from these rather than from the whole
   * matrix, so the figures on the card describe the colour the shopper is
   * looking at. Previously "From ₱X" was a min across every colour, so it
   * could quote a price the highlighted swatch does not have.
   *
   * If the colour matches nothing — a colour renamed without regenerating
   * the matrix — this falls back to the full set so the card still shows a
   * plausible range. Display degrades; the add button does not (see
   * `addableVariant`, which fails closed).
   */
  const colorVariants = useMemo(() => {
    const all = product.variants ?? [];
    if (all.length === 0 || !selectedColor) return all;
    const scoped = all.filter((v) => v.color === selectedColor.name);
    return scoped.length > 0 ? scoped : all;
  }, [product.variants, selectedColor]);

  const { minPrice, maxPrice, maxOriginalPrice } = useMemo(() => {
    if (colorVariants.length === 0) {
      return {
        minPrice: product.price,
        maxPrice: product.price,
        maxOriginalPrice: product.originalPrice,
      };
    }
    const originals = colorVariants
      .map((v) => v.originalPrice)
      .filter((p): p is number => typeof p === "number");
    return {
      minPrice: Math.min(...colorVariants.map((v) => v.price)),
      maxPrice: Math.max(...colorVariants.map((v) => v.price)),
      maxOriginalPrice:
        originals.length > 0 ? Math.max(...originals) : product.originalPrice,
    };
  }, [colorVariants, product.price, product.originalPrice]);

  const displayStock =
    colorVariants.length > 0
      ? colorVariants.reduce((sum, v) => sum + v.stock, 0)
      : product.stock;

  /**
   * The one variant this card could add on its own: the selected colour in
   * the sizeless row. For a product with sizes there is no such row, which
   * is exactly why the button below becomes "Choose options" instead.
   */
  const addableVariant = hasVariants
    ? product.variants!.find(
        (v) =>
          (v.color ?? undefined) === (selectedColor?.name ?? undefined) &&
          !v.size,
      )
    : undefined;

  const soldOut = displayStock <= 0;
  // A product with variants that resolves to none is a data problem (a
  // renamed colour, a stale matrix). Refuse rather than guess a price.
  const canAdd = !hasSizes && !soldOut && (!hasVariants || !!addableVariant);

  const href = `/product/${product.id}`;

  const handleAdd = () => {
    if (!canAdd) return;
    onAddToCart({
      id: product.id,
      name: product.name,
      price: addableVariant?.price ?? product.price,
      originalPrice: addableVariant?.originalPrice ?? product.originalPrice,
      image,
      color: selectedColor?.name,
      variantStock: addableVariant?.stock ?? product.stock,
      quantity: 1,
    });
  };

  return (
    /*
      A div, not a Link.
      This card holds buttons, and an <a> may not contain interactive
      elements — which is why every swatch here used to need
      preventDefault + stopPropagation to stop a click from navigating.
      The link now lives on the title and stretches over the card with a
      pseudo-element, so the whole card is still one click target while the
      controls above it are plain buttons that need no interception.
    */
    <div className="group relative flex flex-col min-h-[420px] bg-surface rounded-2xl border border-border overflow-hidden card-hover">
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

        {soldOut && (
          <div className="absolute inset-0 z-10 bg-surface/70 flex items-center justify-center pointer-events-none">
            <span className="bg-surface border border-border text-muted text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full">
              Sold out
            </span>
          </div>
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
            <Link
              href={href}
              className="after:absolute after:inset-0 after:content-[''] hover:text-primary transition-colors"
            >
              {product.name}
            </Link>
          </h2>
          <div className="flex flex-col items-end">
            {maxOriginalPrice && maxOriginalPrice > minPrice && (
              <span className="text-muted text-xs line-through tabular-nums -mb-1">
                ₱{maxOriginalPrice.toFixed(2)}
              </span>
            )}
            <span className="text-primary font-semibold text-sm whitespace-nowrap tabular-nums">
              {minPrice < maxPrice ? "From " : ""}₱{minPrice.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="flex-grow" />

        {product.colors && product.colors.length > 0 && (
          <div className="relative z-10 flex items-center gap-1.5 mb-4 w-fit">
            {product.colors.map((color) => {
              const isSelected = selectedColor?.name === color.name;
              return (
                <button
                  key={color.name}
                  type="button"
                  title={color.name}
                  onClick={() => setSelectedColor(color)}
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

        {/*
          A card cannot show sizes, so it must not be where a size is
          chosen. For a sized product it hands off to the detail page
          instead of adding a line with `size: undefined` at the base
          price — which is what it used to do, and which billed every size
          at the cheapest variant's price.
        */}
        {hasSizes && !soldOut ? (
          <Link
            href={href}
            className="relative z-10 w-full flex items-center justify-center gap-2 border border-primary text-primary py-2.5 rounded-xl font-medium text-sm hover:bg-primary/5 transition-colors"
          >
            Choose options
          </Link>
        ) : (
          <button
            type="button"
            disabled={!canAdd}
            onClick={handleAdd}
            className="relative z-10 w-full flex items-center justify-center gap-2 bg-primary text-white py-2.5 rounded-xl font-medium text-sm hover:bg-primary-hover transition-all duration-300 transform active:scale-95 motion-reduce:transform-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-primary disabled:active:scale-100"
          >
            {!soldOut && <Plus className="w-4 h-4" />}
            {soldOut ? "Sold out" : canAdd ? "Add to cart" : "Unavailable"}
          </button>
        )}
      </div>
    </div>
  );
}
