"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Copy } from "lucide-react";
import PhotoField from "./PhotoField";
import type { ColorVariant, ProductVariant } from "@/lib/models/product";

interface VariantMatrixEditorProps {
  colors: ColorVariant[];
  sizes: string[];
  variants: ProductVariant[];
  onChange: (variants: ProductVariant[]) => void;
}

/** Stable identity for a combination, used for lookups and React keys. */
function keyOf(color?: string, size?: string) {
  return `${color ?? ""}|${size ?? ""}`;
}

export default function VariantMatrixEditor({
  colors,
  sizes,
  variants,
  onChange,
}: VariantMatrixEditorProps) {
  /*
    Memoised on the caller's array identity.

    This used to be a bare `colors.filter(...)` in the component body,
    which produced a new array on every render. The `useMemo` below
    depended on it, so the memo never held; the effect depended on the
    memo, so the effect ran every render too. It only avoided an update
    loop because of the `changed` guard inside it.
  */
  const validColors = useMemo(
    () => colors.filter((c) => c.name.trim() !== ""),
    [colors],
  );

  const expectedCombinations = useMemo(() => {
    const combs: { color?: string; size?: string }[] = [];
    if (validColors.length > 0 && sizes.length > 0) {
      validColors.forEach((c) =>
        sizes.forEach((s) => combs.push({ color: c.name, size: s })),
      );
    } else if (validColors.length > 0) {
      validColors.forEach((c) => combs.push({ color: c.name }));
    } else if (sizes.length > 0) {
      sizes.forEach((s) => combs.push({ size: s }));
    }
    return combs;
  }, [validColors, sizes]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [bulk, setBulk] = useState({ originalPrice: "", price: "", stock: "" });

  /*
    Keeps `variants` aligned with the combinations the colours and sizes
    above imply.

    The important detail is that an existing row is carried over whole
    rather than rebuilt. A row now holds a photo, so regenerating it from
    scratch on an unrelated change — adding a fourth size, say — would
    silently wipe every photo already assigned.
  */
  useEffect(() => {
    if (expectedCombinations.length === 0) {
      if (variants.length > 0) onChange([]);
      return;
    }

    const byKey = new Map(variants.map((v) => [keyOf(v.color, v.size), v]));
    const next = expectedCombinations.map(
      (comb) =>
        byKey.get(keyOf(comb.color, comb.size)) ?? {
          color: comb.color,
          size: comb.size,
          price: 0,
          originalPrice: undefined,
          stock: 0,
        },
    );

    const same =
      next.length === variants.length &&
      next.every((v, i) => v === variants[i]);
    if (!same) onChange(next);
  }, [expectedCombinations, variants, onChange]);

  const grouped = useMemo(() => {
    if (validColors.length === 0) {
      return [{ color: null as ColorVariant | null, rows: variants }];
    }
    return validColors.map((color) => ({
      color,
      rows: variants.filter((v) => v.color === color.name),
    }));
  }, [validColors, variants]);

  if (expectedCombinations.length === 0) return null;

  const patch = (color: string | undefined, size: string | undefined, next: Partial<ProductVariant>) => {
    onChange(
      variants.map((v) =>
        keyOf(v.color, v.size) === keyOf(color, size) ? { ...v, ...next } : v,
      ),
    );
  };

  const applyBulk = () => {
    const price = parseFloat(bulk.price);
    const originalPrice = parseFloat(bulk.originalPrice);
    const stock = parseInt(bulk.stock, 10);
    onChange(
      variants.map((v) => ({
        ...v,
        price: Number.isNaN(price) ? v.price : price,
        originalPrice: Number.isNaN(originalPrice)
          ? v.originalPrice
          : originalPrice,
        stock: Number.isNaN(stock) ? v.stock : stock,
      })),
    );
  };

  /** Copies a colour's own photo onto each of its sizes. */
  const applyColorPhoto = (color: ColorVariant) => {
    onChange(
      variants.map((v) =>
        v.color === color.name ? { ...v, image: color.image } : v,
      ),
    );
  };

  const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
  const prices = variants.map((v) => v.price).filter((p) => p > 0);
  const fromPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const unpriced = variants.filter((v) => v.price <= 0).length;

  return (
    <div className="bg-zinc-50 border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-white">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h3 className="text-sm font-medium text-zinc-900">
            {expectedCombinations.length} combination
            {expectedCombinations.length === 1 ? "" : "s"}
          </h3>
          {unpriced > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="w-3.5 h-3.5" />
              {unpriced} still need a price
            </p>
          )}
        </div>

        <div className="flex items-end gap-2 flex-wrap mt-3">
          <p className="text-xs text-zinc-500 self-center mr-1">
            Fill every row:
          </p>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Original"
            value={bulk.originalPrice}
            onChange={(e) =>
              setBulk((b) => ({ ...b, originalPrice: e.target.value }))
            }
            aria-label="Original price for every combination"
            className="w-24 text-right bg-white border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Price"
            value={bulk.price}
            onChange={(e) => setBulk((b) => ({ ...b, price: e.target.value }))}
            aria-label="Discounted price for every combination"
            className="w-24 text-right bg-white border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
          <input
            type="number"
            min="0"
            step="1"
            placeholder="Stock"
            value={bulk.stock}
            onChange={(e) => setBulk((b) => ({ ...b, stock: e.target.value }))}
            aria-label="Stock for every combination"
            className="w-20 text-right bg-white border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
          <button
            type="button"
            onClick={applyBulk}
            className="px-3 py-1.5 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors"
          >
            Apply
          </button>
        </div>
      </div>

      {grouped.map(({ color, rows }) => {
        const groupKey = color?.name ?? "__nocolor__";
        const isCollapsed = collapsed[groupKey];
        const missingPhotos = rows.filter((r) => !r.image).length;

        return (
          <div key={groupKey} className="border-b border-border last:border-b-0">
            {color && (
              <div className="flex items-center gap-3 px-4 py-2.5 bg-white">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [groupKey]: !c[groupKey] }))
                  }
                  aria-expanded={!isCollapsed}
                  className="flex items-center gap-2 text-sm font-medium text-zinc-900 hover:text-zinc-600 transition-colors"
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                  <span
                    className="w-4 h-4 rounded-full border border-black/10 shrink-0"
                    style={{ backgroundColor: color.hex || "#d4d4d8" }}
                  />
                  {color.name}
                </button>

                <span className="text-xs text-zinc-500">
                  {rows.length} size{rows.length === 1 ? "" : "s"}
                  {missingPhotos > 0 && ` · ${missingPhotos} need photos`}
                </span>

                <div className="flex-1" />

                {color.image && missingPhotos > 0 && (
                  <button
                    type="button"
                    onClick={() => applyColorPhoto(color)}
                    className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 border border-border rounded-lg px-2.5 py-1.5 transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                    Use this photo for all {rows.length}
                  </button>
                )}
              </div>
            )}

            {!isCollapsed && (
              <div className="divide-y divide-border bg-white">
                {rows.map((variant) => {
                  const rowLabel =
                    [variant.color, variant.size].filter(Boolean).join(" ") ||
                    "Default";
                  return (
                    <div
                      key={keyOf(variant.color, variant.size)}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <PhotoField
                        value={variant.image}
                        onChange={(path) =>
                          patch(variant.color, variant.size, { image: path })
                        }
                        label={`Photo for ${rowLabel}`}
                      />

                      <div className="w-20 shrink-0 text-sm font-medium text-zinc-900">
                        {variant.size || rowLabel}
                      </div>

                      <label className="flex-1 min-w-0">
                        <span className="sr-only">
                          Original price for {rowLabel}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Original"
                          value={variant.originalPrice ?? ""}
                          onChange={(e) => {
                            const parsed = parseFloat(e.target.value);
                            patch(variant.color, variant.size, {
                              originalPrice: Number.isNaN(parsed)
                                ? undefined
                                : parsed,
                            });
                          }}
                          className="w-full text-right bg-zinc-50 border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                        />
                      </label>

                      <label className="flex-1 min-w-0">
                        <span className="sr-only">Price for {rowLabel}</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Price"
                          value={variant.price || ""}
                          onChange={(e) => {
                            const parsed = parseFloat(e.target.value);
                            patch(variant.color, variant.size, {
                              price: Number.isNaN(parsed) ? 0 : parsed,
                            });
                          }}
                          className={`w-full text-right bg-zinc-50 border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 ${
                            variant.price > 0 ? "border-border" : "border-amber-300"
                          }`}
                        />
                      </label>

                      <label className="w-20 shrink-0">
                        <span className="sr-only">Stock for {rowLabel}</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="Stock"
                          value={variant.stock || ""}
                          onChange={(e) => {
                            const parsed = parseInt(e.target.value, 10);
                            patch(variant.color, variant.size, {
                              stock: Number.isNaN(parsed) ? 0 : parsed,
                            });
                          }}
                          className="w-full text-right bg-zinc-50 border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                        />
                      </label>

                      <span className="w-16 shrink-0 text-right text-xs text-zinc-400">
                        {variant.stock === 0 ? "sold out" : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* What the numbers above will actually produce, so the effect of an
          edit is visible without saving and navigating to the storefront. */}
      <div className="px-4 py-3 bg-white border-t border-border text-sm text-zinc-600">
        Storefront will show:{" "}
        <span className="font-medium text-zinc-900 tabular-nums">
          {fromPrice > 0 ? `From ₱${fromPrice.toFixed(2)}` : "no price yet"}
        </span>{" "}
        · <span className="tabular-nums">{totalStock}</span> units total
      </div>
    </div>
  );
}
