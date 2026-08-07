"use client";

import { useEffect, useMemo, useState } from "react";
import { useCartStore } from "@/lib/store";
import { ChevronDown } from "lucide-react";
import ProductCard, { type CardProduct } from "@/components/ProductCard";

type Product = CardProduct;

type SortOption = "featured" | "price-asc" | "price-desc" | "name-asc";

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: "Featured", value: "featured" },
  { label: "Price: low to high", value: "price-asc" },
  { label: "Price: high to low", value: "price-desc" },
  { label: "Name: A to Z", value: "name-asc" },
];

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortOption>("featured");
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [maxPrice, setMaxPrice] = useState(100000);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const addItem = useCartStore((state) => state.addItem);

  const toggle = (value: string, list: string[]) =>
    list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];

  const [availableBrands, setAvailableBrands] = useState<{id: string, name: string}[]>([]);

  useEffect(() => {
    fetch("/api/brands")
      .then((res) => res.json())
      .then((data) => setAvailableBrands(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to fetch brands", err));
  }, []);

  const colors = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const p of products) {
      for (const c of p.colors || []) {
        if (!map.has(c.name)) map.set(c.name, c.hex);
      }
    }
    return Array.from(map.entries()).map(([name, hex]) => ({ name, hex }));
  }, [products]);

  useEffect(() => {
    fetch("/api/products")
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          console.error("Failed to fetch products:", text);
          return [];
        }
        return res.json();
      })
      .then((data) => {
        setProducts(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Network or parsing error:", err);
        setProducts([]);
        setLoading(false);
      });
  }, []);

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
        return 0; // maintain original relative order or fallback to _id via API order
      });
    }
    if (sort === "price-asc") sorted.sort((a, b) => a.price - b.price);
    if (sort === "price-desc") sorted.sort((a, b) => b.price - a.price);
    if (sort === "name-asc")
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [
    products,
    sort,
    maxPrice,
    selectedBrands,
    selectedColors,
  ]);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-64px)] items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-zinc-900 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-500 text-sm">Loading catalog...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Breadcrumb + sort bar */}
      <div className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-between text-sm">
          <span className="text-zinc-500">Home / Shop all</span>
          
          <div className="relative">
            <button
              onClick={() => setIsSortOpen(!isSortOpen)}
              className="flex items-center gap-1.5 text-zinc-700 hover:text-zinc-900 transition-colors"
            >
              Sort by:
              <span className="font-medium text-zinc-900">
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
                <div className="absolute right-0 top-full mt-2 w-48 bg-surface border border-border rounded-xl shadow-xl shadow-black/5 overflow-hidden z-20 animate-in fade-in slide-in-from-top-2 duration-200">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setSort(opt.value);
                        setIsSortOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                        sort === opt.value
                          ? "bg-zinc-50 font-medium text-zinc-900"
                          : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                      }`}
                    >
                      {opt.label}
                      {sort === opt.value && (
                        <div className="w-1.5 h-1.5 rounded-full bg-zinc-900" />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="mb-10 space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            American Tourister - Sale
          </h1>
          <p className="text-zinc-500 max-w-2xl">
            Handcrafted goods designed to elevate your everyday workspace.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-10">
          {/* Product grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
            {visibleProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onAddToCart={(p, color, size) => addItem({ ...p, quantity: 1, color, size })}
              />
            ))}

            {visibleProducts.length === 0 && (
              <div className="col-span-full text-center py-16 text-zinc-500 text-sm">
                No products match the selected filters.
              </div>
            )}
          </div>

          {/* Filters sidebar */}
          <aside className="lg:border-l lg:border-border lg:pl-8 h-fit">
            <h3 className="font-medium text-zinc-900 mb-4">Filters</h3>

            {availableBrands.length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
                  Brand
                </p>
                <div className="space-y-2 text-sm text-zinc-700">
                  {availableBrands.map((brandObj) => (
                    <label key={brandObj.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="rounded border-border"
                        checked={selectedBrands.includes(brandObj.name)}
                        onChange={() =>
                          setSelectedBrands((prev) => toggle(brandObj.name, prev))
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
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
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
                        onClick={() =>
                          setSelectedColors((prev) =>
                            toggle(color.name, prev),
                          )
                        }
                        className={`w-7 h-7 rounded-full border-2 transition-colors ${
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
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
                Shop by price
              </p>
              <input
                type="range"
                min={0}
                max={100000}
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                className="w-full accent-zinc-900"
              />
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
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
