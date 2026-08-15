"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, X } from "lucide-react";
import { BUCKET_LABELS, bucketFromDir, suggestFor } from "@/lib/photoBuckets";
import { usePhotoLibrary, type Photo } from "./usePhotoLibrary";
import PhotoLibraryBrowser from "./PhotoLibraryBrowser";

interface PhotoFieldProps {
  value?: string;
  onChange: (path: string | undefined) => void;
  /** Announced to screen readers, e.g. "main photo for Sporty Blue 55cm". */
  label: string;
  /**
   * The size this field is filling. Used only to rank the library — the
   * suggestion never restricts what can be chosen.
   */
  sizeLabel?: string;
  /** Every size on the product, so this size's position can be worked out. */
  allSizes?: string[];
  size?: "sm" | "md";
}

/**
 * Reads the folder back out of a stored path, for display next to the value.
 *
 * The library is the authority, but a saved path may name a file that has
 * since been moved or deleted, in which case there is no library entry to ask.
 * Parsing the path means the field can still say "Large" for a value it cannot
 * otherwise find, instead of going blank and implying nothing is set.
 */
function bucketOfPath(path: string) {
  if (!path.startsWith("/items/")) return "other" as const;
  const segments = path.slice("/items/".length).split("/");
  return bucketFromDir(segments.length > 1 ? segments[0] : "");
}

/**
 * A single-photo picker sized to sit inside a table row.
 *
 * `PhotoPicker` renders the whole library inline, which is right when it owns a
 * whole section but unusable repeated once per variant. This shows a thumbnail
 * and opens the library in a popover on demand, so a matrix of twelve
 * combinations stays a matrix rather than twelve galleries.
 */
export default function PhotoField({
  value,
  onChange,
  label,
  sizeLabel,
  allSizes,
  size = "sm",
}: PhotoFieldProps) {
  const [open, setOpen] = useState(false);
  const { photos, loading } = usePhotoLibrary();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const suggestion = useMemo(
    () => suggestFor(sizeLabel, allSizes),
    [sizeLabel, allSizes],
  );

  // Escape closes; a click outside closes. Without the keyboard path the
  // popover is a trap for anyone not using a mouse. Focus returns to the
  // trigger on Escape so a keyboard user is not dropped at the top of the
  // document — the matrix has two of these per row and losing your place in it
  // is the difference between usable and not.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
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

  const current = value
    ? (photos.find((p) => p.path === value) ??
      ({
        filename: value.split("/").pop() ?? value,
        path: value,
        bucket: bucketOfPath(value),
        dir: "",
      } satisfies Photo))
    : undefined;

  const pick = (photo: Photo) => {
    onChange(photo.path);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={
          current
            ? `Change ${label} — currently ${current.filename}, ${BUCKET_LABELS[current.bucket]}`
            : `Choose ${label}`
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`${box} rounded-lg overflow-hidden border relative shrink-0 bg-zinc-50 flex items-center justify-center transition-colors ${
          value
            ? "border-border hover:border-zinc-400"
            : "border-dashed border-zinc-300 hover:border-zinc-500"
        }`}
      >
        {value ? (
          <>
            <Image src={value} alt="" fill sizes="56px" className="object-cover" />
            {/* The folder, on the collapsed field. Answers "is this the large
                one?" without opening anything — which is the whole complaint
                that started this. */}
            {current && (
              <span
                aria-hidden="true"
                className="absolute bottom-0 right-0 z-10 px-1 text-[9px] font-bold leading-tight bg-black/65 text-white rounded-tl"
              >
                {BUCKET_LABELS[current.bucket].charAt(0)}
              </span>
            )}
          </>
        ) : (
          <ImagePlus className="w-4 h-4 text-zinc-400" />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full mt-2 z-30 w-[24rem] max-h-96 overflow-y-auto bg-white border border-border rounded-xl shadow-xl p-3"
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-700 truncate">{label}</p>
              {current ? (
                <p className="text-[11px] text-zinc-400 truncate" title={current.filename}>
                  {BUCKET_LABELS[current.bucket]} · {current.filename}
                </p>
              ) : (
                <p className="text-[11px] text-zinc-400">Nothing chosen yet</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(undefined);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  className="text-xs text-zinc-500 hover:text-red-500 transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
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
              No image files found under{" "}
              <code className="bg-zinc-100 px-1 py-0.5 rounded">public/items/</code>.
              Add one to the codebase and deploy before it appears here.
            </p>
          ) : (
            <PhotoLibraryBrowser
              photos={photos}
              suggestion={suggestion}
              onPick={pick}
              stateOf={(photo) => (photo.path === value ? "main" : null)}
              autoFocusSearch
            />
          )}
        </div>
      )}
    </div>
  );
}
