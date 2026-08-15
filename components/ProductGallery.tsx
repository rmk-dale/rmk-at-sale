"use client";

import { useState } from "react";
import Image from "next/image";
import { ShoppingBag } from "lucide-react";

export interface GalleryThumbnail {
  src?: string;
  /** What this photo is, for the thumbnail's accessible name. */
  label: string;
}

interface ProductGalleryProps {
  name: string;
  /** Most-specific-first: the variant's photo, then the colour's, then the product's. */
  hero?: string;
  /** The hero's partner, cross-faded in on hover. Omitted when there isn't one. */
  heroHover?: string;
  /** Everything selectable in the rail, in display order. Duplicates are dropped. */
  thumbnails: GalleryThumbnail[];
}

/**
 * Hero image plus a thumbnail rail.
 *
 * The hero follows the selection: picking a size swaps it to that exact
 * colour-and-size photo, and hovering it cross-fades to that same
 * combination's second photo. A shopper can still override by clicking a
 * thumbnail, and that override is dropped as soon as the selection changes
 * again — `hero` is the source of truth and `override` is only consulted while
 * it still points at something in the current rail.
 *
 * Hover is an enhancement, never the only route to a photo: every image the
 * hero can show is also in the rail, so touch and keyboard users reach the
 * hover shot by tapping it. That is also why the swap is suppressed while an
 * override is active — once a shopper has picked a specific photo, hovering
 * should not quietly show them a different one.
 */
export default function ProductGallery({
  name,
  hero,
  heroHover,
  thumbnails,
}: ProductGalleryProps) {
  const [override, setOverride] = useState<string | null>(null);

  // Dedup by src, keeping the first label given for each — the caller lists
  // them most-specific-first, so the first mention is the most accurate
  // description of why that photo is in the rail.
  const rail: GalleryThumbnail[] = [];
  const seen = new Set<string>();
  for (const thumb of thumbnails) {
    if (!thumb.src || seen.has(thumb.src)) continue;
    seen.add(thumb.src);
    rail.push(thumb);
  }

  const usingOverride = override !== null && seen.has(override);
  const active = usingOverride ? override : hero;

  /*
    The image to cross-fade to, or undefined for no hover behaviour at all.

    Three ways that is the right answer: there is no hover photo; it is the
    same file as the one already showing (a colour whose hover was copied onto
    its main, which would "fade" to an identical frame); or the shopper has
    clicked a thumbnail and is looking at a photo they chose.
  */
  const hoverPartner =
    !usingOverride && heroHover && heroHover !== active ? heroHover : undefined;

  return (
    <div className="lg:sticky lg:top-24 lg:self-start">
      <div className="group aspect-[4/5] w-full relative bg-surface rounded-2xl border border-border overflow-hidden flex items-center justify-center">
        {active ? (
          <>
            <Image
              src={active}
              alt={name}
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className={`object-cover transition-opacity duration-500 motion-reduce:transition-none ${
                hoverPartner ? "group-hover:opacity-0" : ""
              }`}
              priority
            />
            {hoverPartner && (
              /*
                Mounted rather than lazily inserted on first hover, matching
                ProductCard so both surfaces behave the same way. Deliberately
                without `priority`: it must not compete with the hero above for
                the LCP slot, but it does need to be decoded before the pointer
                arrives or the first hover shows a blank frame.
              */
              <Image
                src={hoverPartner}
                alt=""
                aria-hidden="true"
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover opacity-0 transition-opacity duration-500 motion-reduce:transition-none group-hover:opacity-100"
              />
            )}
          </>
        ) : (
          <ShoppingBag className="w-20 h-20 text-border" />
        )}
      </div>

      {rail.length > 1 && (
        <div className="flex gap-3 mt-4">
          {rail.map((thumb) => (
            <button
              key={thumb.src}
              type="button"
              onClick={() => setOverride(thumb.src!)}
              aria-label={thumb.label}
              aria-current={active === thumb.src}
              className={`w-16 h-16 rounded-xl overflow-hidden border relative transition-colors ${
                active === thumb.src
                  ? "border-primary"
                  : "border-border hover:border-muted"
              }`}
            >
              <Image
                src={thumb.src!}
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
