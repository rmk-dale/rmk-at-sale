"use client";

import { useState } from "react";
import Image from "next/image";
import { ShoppingBag } from "lucide-react";

interface ProductGalleryProps {
  name: string;
  /** Most-specific-first: the variant's photo, then the colour's, then the product's. */
  hero?: string;
  /** Everything selectable in the rail, in display order. Duplicates are dropped. */
  thumbnails: (string | undefined)[];
}

/**
 * Hero image plus a thumbnail rail.
 *
 * The hero follows the selection: picking a size swaps it to that exact
 * colour-and-size photo. A shopper can still override by clicking a
 * thumbnail, and that override is dropped as soon as the selection changes
 * again — `hero` is the source of truth and `override` is only consulted
 * while it still points at something in the current rail.
 */
export default function ProductGallery({
  name,
  hero,
  thumbnails,
}: ProductGalleryProps) {
  const [override, setOverride] = useState<string | null>(null);

  const rail = Array.from(new Set(thumbnails.filter(Boolean) as string[]));
  const active = override && rail.includes(override) ? override : hero;

  return (
    <div className="lg:sticky lg:top-24 lg:self-start">
      <div className="aspect-[4/5] w-full relative bg-surface rounded-2xl border border-border overflow-hidden flex items-center justify-center">
        {active ? (
          <Image
            src={active}
            alt={name}
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
            priority
          />
        ) : (
          <ShoppingBag className="w-20 h-20 text-border" />
        )}
      </div>

      {rail.length > 1 && (
        <div className="flex gap-3 mt-4">
          {rail.map((thumb) => (
            <button
              key={thumb}
              type="button"
              onClick={() => setOverride(thumb)}
              aria-label="Show this photo"
              aria-current={active === thumb}
              className={`w-16 h-16 rounded-xl overflow-hidden border relative transition-colors ${
                active === thumb
                  ? "border-primary"
                  : "border-border hover:border-muted"
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
  );
}
