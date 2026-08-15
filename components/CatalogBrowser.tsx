"use client";

import { useMemo, useState, useEffect } from "react";
import Image from "next/image";
import { useCartStore } from "@/lib/store";
import { ChevronDown } from "lucide-react";
import ProductCard, { type CardProduct } from "@/components/ProductCard";
import type { PublicBrand } from "@/lib/models/brand";
import { CAMPAIGN } from "@/lib/campaign";

type SortOption = "featured" | "price-asc" | "price-desc" | "name-asc";

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: "Featured", value: "featured" },
  { label: "Price: low to high", value: "price-asc" },
  { label: "Price: high to low", value: "price-desc" },
  { label: "Name: A to Z", value: "name-asc" },
];

const MAX_PRICE = 100000;

/**
 * Banner slides.
 *
 * All three used to point at `/home-image.png`, so the carousel rotated
 * the same picture on a five-second timer. The other two artworks were
 * already sitting in `public/` — they are wired up here.
 *
 * Each slide carries its own description because each one now says
 * something different. `homeimage3` is a wider crop (2.55 vs 2.28), which
 * is why the frame keeps `object-contain`: it letterboxes into the Paper
 * background rather than cropping the promo text out of the third slide.
 */
const SLIDES = [
  {
    src: "/home-image.png",
    alt: `${CAMPAIGN.name}: ${CAMPAIGN.offer}. ${CAMPAIGN.window}.`,
  },
  { src: "/homeimage1.png", alt: "American Tourister sale — featured luggage" },
  { src: "/homeimage2.png", alt: "American Tourister sale — bundle offers" },
];

/**
 * The interactive half of the storefront listing.
 *
 * Products and brands arrive as props from the server component that
 * renders this, so there is no fetch-on-mount and no loading state: the
 * grid is present in the initial HTML. Everything below is filtering and
 * sorting over that already-delivered array, which is why it stays a
 * client component.
 */
export default function CatalogBrowser({
  products,
  brands,
}: {
  products: CardProduct[];
  brands: PublicBrand[];
}) {
  const [sort, setSort] = useState<SortOption>("featured");
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [maxPrice, setMaxPrice] = useState(MAX_PRICE);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const addItem = useCartStore((state) => state.addItem);

  const [currentSlide, setCurrentSlide] = useState(0);
  const slides = SLIDES;

  useEffect(() => {
    /*
      Content that moves on its own is a WCAG 2.2.2 problem: some people
      cannot read a panel before it slides away, and for others the motion
      itself is the problem. Honouring the OS-level reduced-motion setting
      leaves the carousel fully usable — the dots still work — it just
      stops advancing without being asked.
    */
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [slides.length]);

  const toggle = (value: string, list: string[]) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const colors = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const p of products) {
      for (const c of p.colors || []) {
        if (!map.has(c.name)) map.set(c.name, c.hex);
      }
    }
    return Array.from(map.entries()).map(([name, hex]) => ({ name, hex }));
  }, [products]);

  const visibleProducts = useMemo(() => {
    const filtered = products.filter((p) => {
      if (p.price > maxPrice) return false;
      if (selectedBrands.length && !selectedBrands.includes(p.brand || ""))
        return false;
      if (
        selectedColors.length &&
        !(p.colors || []).some((c) => selectedColors.includes(c.name))
      )
        return false;
      return true;
    });
    const sorted = [...filtered];
    if (sort === "featured") {
      sorted.sort((a, b) => {
        if (a.featured && !b.featured) return -1;
        if (!a.featured && b.featured) return 1;
        return 0; // otherwise keep the server's _id ordering
      });
    }
    if (sort === "price-asc") sorted.sort((a, b) => a.price - b.price);
    if (sort === "price-desc") sorted.sort((a, b) => b.price - a.price);
    if (sort === "name-asc") sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [products, sort, maxPrice, selectedBrands, selectedColors]);

  return (
    <div>
      {/*
        The visible page heading was removed for a cleaner layout, but the
        page still needs one. This is the only line that tells a crawler or
        a screen reader what the page is, and outside the strip it is the
        only place the campaign window exists as text rather than as pixels
        inside the banner. `sr-only` keeps the semantics and renders
        nothing, so the layout is unaffected.
      */}
      <h1 className="sr-only">
        American Tourister luggage sale — {CAMPAIGN.window}
      </h1>

      {/*
        Banner carousel.

        The height is derived from the artwork's own ratio via `aspect-`
        rather than pinned to a pixel value. A fixed height forces
        `object-cover` to crop the sides to fill it — at 1232px wide the
        previous `h-[700px]` threw away roughly 180px off each edge — and
        the crop got worse as the viewport narrowed. Tying the box to
        1893/831 means the frame follows the image instead of the image
        fighting the frame, so nothing is lost at any breakpoint.
      */}
      <div className="max-w-7xl mx-auto px-6 pt-6 pb-7">
        <div className="relative w-full overflow-hidden rounded-2xl bg-background ring-1 ring-black/5 shadow-lg shadow-[#7a6153]/20 aspect-[1893/831]">
          <div
            className="flex w-full h-full transition-transform duration-500 ease-in-out motion-reduce:transition-none"
            style={{ transform: `translateX(-${currentSlide * 100}%)` }}
          >
            {slides.map((slide, slideIndex) => (
              <div key={slide.src} className="min-w-full relative h-full">
                <Image
                  src={slide.src}
                  // Describes the offer, not the file. "Slide 2" tells a
                  // screen-reader user nothing; the sale terms are the
                  // actual content of these images.
                  alt={slide.alt}
                  fill
                  // The banner spans the full content column, which is capped
                  // at max-w-7xl minus px-6 padding = 1232px.
                  sizes="(max-width: 1280px) 100vw, 1232px"
                  // Only the first slide is in the initial viewport, so only
                  // it is worth preloading. Marking all three would have them
                  // compete with each other for the same connection and push
                  // out LCP rather than pulling it in.
                  priority={slideIndex === 0}
                  loading={slideIndex === 0 ? undefined : "lazy"}
                  // `contain` over `cover`: should a future slide ship at a
                  // different ratio it letterboxes rather than silently
                  // cropping the promo text out of frame. The box behind it
                  // is Paper, so those bars disappear into the page instead
                  // of showing as cold grey.
                  className="object-contain"
                />
              </div>
            ))}
          </div>

          {/* Carousel Indicators */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
            {slides.map((slide, slideIndex) => (
              <button
                key={slide.src}
                onClick={() => setCurrentSlide(slideIndex)}
                // The artwork behind these runs from pale orange to deep
                // red, so a plain white dot vanishes over the light corner.
                // The ring gives it an edge on every part of the image.
                className={`w-2.5 h-2.5 rounded-full bg-white ring-1 ring-black/20 transition-opacity ${
                  currentSlide === slideIndex
                    ? "opacity-100"
                    : "opacity-50 hover:opacity-75"
                }`}
                aria-label={`Go to slide ${slideIndex + 1}`}
                aria-current={currentSlide === slideIndex}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Breadcrumb + sort bar */}
      <div className="border-y border-border">
        <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-between text-sm">
          <span className="text-muted">Home / Shop all</span>

          <div className="relative">
            <button
              onClick={() => setIsSortOpen(!isSortOpen)}
              className="flex items-center gap-1.5 text-muted hover:text-foreground transition-colors"
            >
              Sort by:
              <span className="font-medium text-foreground">
                {SORT_OPTIONS.find((o) => o.value === sort)?.label}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  isSortOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {isSortOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setIsSortOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-48 bg-surface border border-border rounded-xl shadow-xl shadow-[#7a6153]/15 overflow-hidden z-20 animate-in fade-in slide-in-from-top-2 duration-200">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setSort(opt.value);
                        setIsSortOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                        sort === opt.value
                          ? "bg-background font-medium text-foreground"
                          : "text-muted hover:bg-background hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                      {sort === opt.value && (
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-10">
          {/* Product grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
            {/*
              A straight pass-through: the card hands back a resolved cart
              line. This used to spread the whole product and bolt a colour
              onto it, which meant `size` was always undefined and `price`
              was the product's base field — min(variants.price) — so every
              size was billed at the cheapest one.
            */}
            {visibleProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onAddToCart={addItem}
              />
            ))}

            {visibleProducts.length === 0 && (
              <div className="col-span-full text-center py-16 text-muted text-sm">
                {products.length === 0
                  ? "No products are available right now."
                  : "No products match the selected filters."}
              </div>
            )}
          </div>

          {/* Filters sidebar */}
          <aside className="lg:border-l lg:border-border lg:pl-8 h-fit">
            <h2 className="font-medium text-foreground mb-4">Filters</h2>

            {brands.length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">
                  Collection Name
                </p>
                <div className="space-y-2 text-sm text-foreground">
                  {brands.map((brandObj) => (
                    <label
                      key={brandObj.id}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-border accent-primary"
                        checked={selectedBrands.includes(brandObj.name)}
                        onChange={() =>
                          setSelectedBrands((prev) =>
                            toggle(brandObj.name, prev),
                          )
                        }
                      />
                      {brandObj.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {colors.length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">
                  Color
                </p>
                <div className="flex flex-wrap gap-2">
                  {colors.map((color) => {
                    const isSelected = selectedColors.includes(color.name);
                    return (
                      <button
                        key={color.name}
                        type="button"
                        title={color.name}
                        aria-pressed={isSelected}
                        onClick={() =>
                          setSelectedColors((prev) => toggle(color.name, prev))
                        }
                        className={`w-7 h-7 rounded-full border-2 transition-colors ${
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
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-muted uppercase tracking-wide mb-3">
                Shop by price
              </p>
              <input
                type="range"
                min={0}
                max={MAX_PRICE}
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                aria-label="Maximum price"
                // Mango was the nicer choice here and it failed the audit:
                // #f5821f against Paper is 2.46:1, under the 3:1 that a
                // form control's filled state has to meet. The action red
                // is 5.52:1. Accessibility beat the aesthetic preference.
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted mt-1">
                <span>₱0</span>
                <span>Up to ₱{maxPrice}</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
