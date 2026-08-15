"use client";

import { useRef } from "react";
import Image from "next/image";
import type { ProductVariant } from "@/lib/models/product";

interface SizeSelectorProps {
  sizes: string[];
  variants?: ProductVariant[];
  /** Name of the colour currently selected, if the product has colours. */
  colorName?: string;
  /** Photo to show for a size whose variant has none of its own. */
  fallbackImage?: string;
  selected: string | null;
  onSelect: (size: string) => void;
}

/**
 * The size picker, as cards rather than text pills.
 *
 * Each card carries the photo of *this colour at this size* and that
 * combination's own price. Showing the price on the card is what stops the
 * price from appearing to change on its own: the differences are visible
 * before the click, so nothing moves unexpectedly after it.
 */
export default function SizeSelector({
  sizes,
  variants,
  colorName,
  fallbackImage,
  selected,
  onSelect,
}: SizeSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const rowFor = (size: string) =>
    variants?.find(
      (v) => (v.color ?? undefined) === (colorName ?? undefined) && v.size === size,
    );

  const anyPhoto = sizes.some((s) => rowFor(s)?.image) || !!fallbackImage;

  // Arrow keys move between options and select as they go, which is what a
  // radiogroup is expected to do. Sold-out options are skipped rather than
  // focused and refused.
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!forward && !back) return;
    e.preventDefault();

    const step = forward ? 1 : -1;
    for (let i = 1; i <= sizes.length; i++) {
      const next = (index + step * i + sizes.length * i) % sizes.length;
      const row = rowFor(sizes[next]);
      if (row && row.stock <= 0) continue;
      onSelect(sizes[next]);
      const buttons =
        containerRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="radio"]',
        );
      buttons?.[next]?.focus();
      return;
    }
  };

  return (
    <div>
      <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">
        Size
        {!selected && (
          <span className="text-primary normal-case tracking-normal font-medium">
            {" — "}please choose
          </span>
        )}
      </p>

      <div
        ref={containerRef}
        role="radiogroup"
        aria-label="Size"
        aria-required="true"
        className="grid grid-cols-2 sm:grid-cols-3 gap-2.5"
      >
        {sizes.map((size, index) => {
          const row = rowFor(size);
          const soldOut = !!row && row.stock <= 0;
          const isSelected = selected === size;
          const photo = row?.image || fallbackImage;

          return (
            <button
              key={size}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${size}${soldOut ? " — sold out" : ""}`}
              tabIndex={isSelected || (!selected && index === 0) ? 0 : -1}
              disabled={soldOut}
              onClick={() => onSelect(size)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`group text-left rounded-xl border-2 overflow-hidden transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted bg-surface"
              } ${soldOut ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              {anyPhoto && (
                <span className="block relative aspect-square bg-background">
                  {photo ? (
                    <Image
                      src={photo}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 120px, 40vw"
                      className="object-cover"
                    />
                  ) : (
                    // No photo anywhere for this combination: the label
                    // carries the card instead, so the row keeps one shape.
                    <span className="absolute inset-0 flex items-center justify-center text-lg font-semibold text-muted">
                      {size}
                    </span>
                  )}
                  {soldOut && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 bg-[linear-gradient(to_top_right,transparent_49%,currentColor_49%,currentColor_51%,transparent_51%)] text-muted"
                    />
                  )}
                </span>
              )}

              <span className="block px-2.5 py-2">
                <span
                  className={`block text-sm font-semibold ${
                    isSelected ? "text-primary" : "text-foreground"
                  }`}
                >
                  {size}
                </span>
                <span className="block text-xs tabular-nums text-muted">
                  {soldOut
                    ? "Sold out"
                    : row
                      ? `₱${row.price.toFixed(2)}`
                      : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
