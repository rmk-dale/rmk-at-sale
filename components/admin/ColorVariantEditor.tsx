"use client";

import { useState } from "react";
import Image from "next/image";
import { Trash2, Plus, ChevronDown, ChevronUp, Star, ImageOff } from "lucide-react";
import PhotoPicker from "./PhotoPicker";
import type { ColorVariant } from "@/lib/models/product";

interface ColorVariantEditorProps {
  initialVariants?: ColorVariant[];
  onChange: (variants: ColorVariant[]) => void;
  defaultImage?: string;
  defaultHoverImage?: string;
}

interface Row extends ColorVariant {
  _key: string;
}

function makeKey() {
  return Math.random().toString(36).slice(2);
}

export default function ColorVariantEditor({
  initialVariants = [],
  onChange,
  defaultImage = "",
  defaultHoverImage = "",
}: ColorVariantEditorProps) {
  const [rows, setRows] = useState<Row[]>(
    initialVariants.map((v) => ({ ...v, _key: makeKey() })),
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const emit = (next: Row[]) => {
    setRows(next);
    onChange(next.map(({ _key, ...v }) => v));
  };

  const addRow = () => {
    const isFirst = rows.length === 0;
    const row: Row = {
      _key: makeKey(),
      name: "",
      hex: "#000000",
      image: isFirst ? defaultImage : "",
      hoverImage: isFirst ? defaultHoverImage : "",
      // The first color added becomes the main display photo automatically.
      isDefault: isFirst,
    };
    emit([...rows, row]);
    setExpanded((e) => ({ ...e, [row._key]: true }));
  };

  const updateRow = (key: string, patch: Partial<ColorVariant>) => {
    emit(rows.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  };

  const makeDefault = (key: string) => {
    emit(rows.map((r) => ({ ...r, isDefault: r._key === key })));
  };

  const removeRow = (key: string) => {
    const wasDefault = rows.find((r) => r._key === key)?.isDefault;
    const next = rows.filter((r) => r._key !== key);
    // Keep exactly one default around if one existed and rows remain.
    if (wasDefault && next.length > 0 && !next.some((r) => r.isDefault)) {
      next[0] = { ...next[0], isDefault: true };
    }
    emit(next);
  };

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <p className="text-xs text-zinc-500">
          The color marked <span className="font-medium">Main display</span>{" "}
          is the photo shoppers see first on the product card and item page,
          before picking a color.
        </p>
      )}

      {rows.map((row) => (
        <div
          key={row._key}
          className={`border rounded-xl p-4 bg-white transition-colors ${
            row.isDefault ? "border-zinc-900" : "border-border"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg overflow-hidden border border-border relative shrink-0 bg-zinc-50 flex items-center justify-center">
              {row.image ? (
                <Image
                  src={row.image}
                  alt={row.name || "Color photo"}
                  fill
                  sizes="40px"
                  className="object-cover"
                />
              ) : (
                <ImageOff className="w-4 h-4 text-zinc-300" />
              )}
            </div>
            <input
              type="color"
              value={row.hex || "#000000"}
              onChange={(e) => updateRow(row._key, { hex: e.target.value })}
              className="w-8 h-8 rounded-full border border-border cursor-pointer p-0 overflow-hidden shrink-0"
              title="Swatch color"
            />
            <input
              value={row.name}
              onChange={(e) => updateRow(row._key, { name: e.target.value })}
              placeholder="Color name, e.g. Sporty Blue"
              className="flex-1 bg-white border border-border rounded-lg px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
            <button
              type="button"
              onClick={() =>
                setExpanded((ex) => ({ ...ex, [row._key]: !ex[row._key] }))
              }
              className="flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 px-2 py-2 whitespace-nowrap"
            >
              Photos
              {expanded[row._key] ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => removeRow(row._key)}
              className="p-2 text-zinc-400 hover:text-red-500 transition-colors shrink-0"
              title="Remove color"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={() => makeDefault(row._key)}
              disabled={row.isDefault}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                row.isDefault
                  ? "bg-zinc-900 text-white border-zinc-900 cursor-default"
                  : "border-border text-zinc-600 hover:border-zinc-400"
              }`}
            >
              <Star
                className="w-3.5 h-3.5"
                fill={row.isDefault ? "currentColor" : "none"}
              />
              {row.isDefault ? "Main display" : "Set as main display"}
            </button>

            {!row.image && (
              <p className="text-xs text-amber-600">
                Choose a photo for this color below.
              </p>
            )}
          </div>

          {expanded[row._key] && (
            <div className="mt-4 pt-4 border-t border-border">
              <PhotoPicker
                image={row.image}
                hoverImage={row.hoverImage || ""}
                onChangeImage={(path) => updateRow(row._key, { image: path })}
                onChangeHoverImage={(path) =>
                  updateRow(row._key, { hoverImage: path })
                }
              />
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 hover:text-zinc-900 border border-dashed border-border rounded-xl px-4 py-2.5 w-full justify-center"
      >
        <Plus className="w-4 h-4" />
        Add color
      </button>
    </div>
  );
}
