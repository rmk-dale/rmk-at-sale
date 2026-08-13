"use client";

import { useEffect, useMemo } from "react";
import type { ColorVariant, ProductVariant } from "@/lib/models/product";

interface VariantMatrixEditorProps {
  colors: ColorVariant[];
  sizes: string[];
  basePrice: number;
  baseStock: number;
  variants: ProductVariant[];
  onChange: (variants: ProductVariant[]) => void;
}

export default function VariantMatrixEditor({
  colors,
  sizes,
  basePrice,
  baseStock,
  variants,
  onChange,
}: VariantMatrixEditorProps) {
  const validColors = colors.filter((c) => c.name.trim() !== "");
  const hasColors = validColors.length > 0;
  const hasSizes = sizes.length > 0;

  // Generate the expected list of combinations
  const expectedCombinations = useMemo(() => {
    const combs: { color?: string; size?: string }[] = [];
    if (hasColors && hasSizes) {
      validColors.forEach((c) => {
        sizes.forEach((s) => {
          combs.push({ color: c.name, size: s });
        });
      });
    } else if (hasColors) {
      validColors.forEach((c) => {
        combs.push({ color: c.name });
      });
    } else if (hasSizes) {
      sizes.forEach((s) => {
        combs.push({ size: s });
      });
    }
    return combs;
  }, [validColors, sizes, hasColors, hasSizes]);

  // Synchronize the variants array with the expected combinations
  useEffect(() => {
    if (expectedCombinations.length === 0) {
      if (variants.length > 0) {
        onChange([]);
      }
      return;
    }

    let changed = false;
    const newVariants = expectedCombinations.map((comb) => {
      const existing = variants.find(
        (v) => v.color === comb.color && v.size === comb.size
      );
      if (existing) return existing;
      
      changed = true;
      return {
        color: comb.color,
        size: comb.size,
        price: 0,
        stock: 0,
      };
    });

    // Also check if any old variants need to be removed
    if (changed || newVariants.length !== variants.length) {
      onChange(newVariants);
    }
  }, [expectedCombinations, variants, basePrice, baseStock, onChange]);

  if (expectedCombinations.length === 0) {
    return null;
  }

  const handleUpdate = (
    index: number,
    field: "price" | "stock",
    value: string
  ) => {
    const parsed = parseFloat(value);
    const updated = [...variants];
    updated[index] = {
      ...updated[index],
      [field]: isNaN(parsed) ? 0 : parsed,
    };
    onChange(updated);
  };

  return (
    <div className="bg-zinc-50 border border-border rounded-xl overflow-hidden mt-4 mb-8">
      <div className="px-4 py-3 border-b border-border bg-zinc-100 flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-900">Per-Variant Pricing & Inventory</h3>
        <p className="text-xs text-zinc-500">Overrides the base price and stock above.</p>
      </div>
      <div className="grid grid-cols-12 gap-4 px-4 py-2 border-b border-border bg-white text-xs font-semibold text-zinc-600 uppercase tracking-wider">
        <div className="col-span-6">Variant</div>
        <div className="col-span-3 text-right">Price (₱)</div>
        <div className="col-span-3 text-right">Stock</div>
      </div>
      <div className="divide-y divide-border bg-white">
        {variants.map((variant, index) => {
          const variantName = [variant.color, variant.size]
            .filter(Boolean)
            .join(" - ");

          return (
            <div
              key={`${variant.color || "none"}-${variant.size || "none"}`}
              className="grid grid-cols-12 gap-4 px-4 py-3 items-center"
            >
              <div className="col-span-6 text-sm font-medium text-zinc-900">
                {variantName}
              </div>
              <div className="col-span-3">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={variant.price}
                  onChange={(e) => handleUpdate(index, "price", e.target.value)}
                  className="w-full text-right bg-zinc-50 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
              <div className="col-span-3">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={variant.stock}
                  onChange={(e) => handleUpdate(index, "stock", e.target.value)}
                  className="w-full text-right bg-zinc-50 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
