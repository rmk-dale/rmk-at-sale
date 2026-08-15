"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, X } from "lucide-react";
import { usePhotoLibrary } from "./usePhotoLibrary";

interface PhotoFieldProps {
  value?: string;
  onChange: (path: string | undefined) => void;
  /** Announced to screen readers, e.g. "Photo for Sporty Blue 55cm". */
  label: string;
  size?: "sm" | "md";
}

/**
 * A single-photo picker sized to sit inside a table row.
 *
 * `PhotoPicker` renders the whole library inline, which is right when it
 * owns a whole section but unusable repeated once per variant. This shows a
 * thumbnail and opens the library in a popover on demand, so a matrix of
 * twelve combinations stays a matrix rather than twelve galleries.
 */
export default function PhotoField({
  value,
  onChange,
  label,
  size = "sm",
}: PhotoFieldProps) {
  const [open, setOpen] = useState(false);
  const { photos, loading } = usePhotoLibrary();
  const containerRef = useRef<HTMLDivElement>(null);

  // Escape closes; a click outside closes. Without the keyboard path the
  // popover is a trap for anyone not using a mouse.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const box = size === "md" ? "w-14 h-14" : "w-11 h-11";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={value ? `Change ${label}` : `Choose ${label}`}
        aria-expanded={open}
        className={`${box} rounded-lg overflow-hidden border relative shrink-0 bg-zinc-50 flex items-center justify-center transition-colors ${
          value
            ? "border-border hover:border-zinc-400"
            : "border-dashed border-zinc-300 hover:border-zinc-500"
        }`}
      >
        {value ? (
          <Image
            src={value}
            alt=""
            fill
            sizes="56px"
            className="object-cover"
          />
        ) : (
          <ImagePlus className="w-4 h-4 text-zinc-400" />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 z-30 w-[22rem] max-h-80 overflow-y-auto bg-white border border-border rounded-xl shadow-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-zinc-700">{label}</p>
            <div className="flex items-center gap-2">
              {value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                  className="text-xs text-zinc-500 hover:text-red-500 transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close photo picker"
                className="p-1 text-zinc-400 hover:text-zinc-700 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-xs text-zinc-500 py-3">Loading photos…</p>
          ) : photos.length === 0 ? (
            <p className="text-xs text-zinc-500 py-3">
              No image files found in{" "}
              <code className="bg-zinc-100 px-1 py-0.5 rounded">
                public/items/
              </code>
              . Add one to the codebase and deploy before it appears here.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {photos.map((photo) => {
                const isSelected = value === photo.path;
                return (
                  <button
                    key={photo.path}
                    type="button"
                    title={photo.filename}
                    onClick={() => {
                      onChange(photo.path);
                      setOpen(false);
                    }}
                    className={`aspect-square relative rounded-lg overflow-hidden border-2 transition-colors ${
                      isSelected
                        ? "border-zinc-900"
                        : "border-transparent hover:border-zinc-300"
                    }`}
                  >
                    <Image
                      src={photo.path}
                      alt={photo.filename}
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
