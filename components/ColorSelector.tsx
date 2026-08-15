"use client";

import { Check } from "lucide-react";
import type { ColorVariant, ProductVariant } from "@/lib/models/product";

function isLightColor(hex?: string): boolean {
  if (!hex) return true;
  const value = hex.replace("#", "");
  if (value.length !== 6) return true;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}

interface ColorSelectorProps {
  colors: ColorVariant[];
  variants?: ProductVariant[];
  selected: ColorVariant | null;
  onSelect: (color: ColorVariant) => void;
}

export default function ColorSelector({
  colors,
  variants,
  selected,
  onSelect,
}: ColorSelectorProps) {
  /** A colour is gone when every size under it is at zero. */
  const isSoldOut = (color: ColorVariant) => {
    const rows = variants?.filter((v) => v.color === color.name) ?? [];
    return rows.length > 0 && rows.every((v) => v.stock <= 0);
  };

  return (
    <div>
      <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">
        Colour
        {selected && (
          <span className="text-foreground normal-case tracking-normal font-medium">
            {" — "}
            {selected.name}
          </span>
        )}
      </p>

      {/*
        A radiogroup, not a row of toggles. These are mutually exclusive, so
        aria-pressed described the wrong interaction and gave keyboard users
        no way to move between them but Tab.
      */}
      <div role="radiogroup" aria-label="Colour" className="flex flex-wrap items-center gap-3">
        {colors.map((color) => {
          const isSelected = selected?.name === color.name;
          const soldOut = isSoldOut(color);
          return (
            <button
              key={color.name}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${color.name}${soldOut ? " — sold out" : ""}`}
              tabIndex={isSelected ? 0 : -1}
              disabled={soldOut}
              onClick={() => onSelect(color)}
              title={color.name}
              className={`relative w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors ${
                isSelected ? "border-primary" : "border-transparent hover:border-border"
              } ${soldOut ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              <span
                className="w-7 h-7 rounded-full border border-black/10 flex items-center justify-center overflow-hidden"
                style={{ backgroundColor: color.hex || "#d4d4d8" }}
              >
                {isSelected && !soldOut && (
                  <Check
                    className="w-3.5 h-3.5"
                    style={{
                      color: isLightColor(color.hex) ? "#1c1512" : "#ffffff",
                    }}
                  />
                )}
              </span>
              {soldOut && (
                <span
                  aria-hidden="true"
                  className="absolute inset-1 rounded-full bg-[linear-gradient(to_top_right,transparent_46%,currentColor_46%,currentColor_54%,transparent_54%)] text-muted"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
