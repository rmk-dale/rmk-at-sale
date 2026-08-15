"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { Search, X } from "lucide-react";
import {
  BUCKET_BADGES,
  BUCKET_LABELS,
  BUCKET_ORDER,
  bucketCounts,
  groupPhotos,
  type PhotoBucket,
  type SizeSuggestion,
} from "@/lib/photoBuckets";
import type { Photo } from "./usePhotoLibrary";

/** How a tile should be outlined. `null` for an unselected tile. */
export type TileState = "main" | "hover" | null;

interface PhotoLibraryBrowserProps {
  photos: Photo[];
  /**
   * The size this picker is filling, if any. Drives the "Suggested for 55cm"
   * group and which folder chip starts selected. Absent for the colour-level
   * picker, which has no size context — it just gets folder groups.
   */
  suggestion?: SizeSuggestion;
  /** Whole-tile click. Used when a tile has no buttons of its own. */
  onPick?: (photo: Photo) => void;
  /** Buttons rendered under each tile, for pickers that assign two roles. */
  renderTileActions?: (photo: Photo) => ReactNode;
  stateOf?: (photo: Photo) => TileState;
  columns?: string;
  autoFocusSearch?: boolean;
  /** Rendered above the filters — the explanatory copy each picker owns. */
  children?: ReactNode;
}

const STATE_RING: Record<"main" | "hover", string> = {
  main: "border-zinc-900",
  hover: "border-emerald-500",
};

/**
 * Search, folder chips and a grouped grid over the photo library.
 *
 * Shared by both pickers so there is exactly one implementation of "which
 * photos, in what order, under which heading". `PhotoField` and `PhotoPicker`
 * differ only in how a tile is committed — one click versus a Main/Hover pair
 * — which is the `onPick` / `renderTileActions` seam.
 *
 * All ranking lives in lib/photoBuckets.ts; this component only renders what
 * it is handed. Nothing here filters a photo out of existence: the chips
 * narrow to a folder the admin explicitly asked for, and search is theirs to
 * clear.
 */
export default function PhotoLibraryBrowser({
  photos,
  suggestion,
  onPick,
  renderTileActions,
  stateOf,
  columns = "grid-cols-4",
  autoFocusSearch = false,
  children,
}: PhotoLibraryBrowserProps) {
  const [query, setQuery] = useState("");
  const [activeBucket, setActiveBucket] = useState<PhotoBucket | undefined>(
    undefined,
  );
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocusSearch) searchRef.current?.focus();
  }, [autoFocusSearch]);

  const counts = useMemo(() => bucketCounts(photos), [photos]);

  const groups = useMemo(
    () => groupPhotos(photos, { suggestion, activeBucket, query }),
    [photos, suggestion, activeBucket, query],
  );

  const shown = groups.reduce((n, g) => n + g.photos.length, 0);

  // Only offer chips for folders that actually contain something. An
  // always-on "Unfiled (0)" chip is a dead control that invites a click and
  // then shows an empty grid.
  const chips = BUCKET_ORDER.filter((bucket) => counts[bucket] > 0);

  return (
    <div>
      {children}

      <div className="flex items-center gap-2 mb-2.5">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${photos.length} photos by filename…`}
            aria-label="Search photos by filename"
            className="w-full bg-white border border-border rounded-lg pl-8 pr-7 py-1.5 text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-700 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <button
          type="button"
          onClick={() => setActiveBucket(undefined)}
          aria-pressed={activeBucket === undefined}
          className={`text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${
            activeBucket === undefined
              ? "bg-zinc-900 text-white border-zinc-900"
              : "border-border text-zinc-600 hover:border-zinc-400"
          }`}
        >
          All {photos.length}
        </button>
        {chips.map((bucket) => (
          <button
            key={bucket}
            type="button"
            onClick={() =>
              setActiveBucket((current) => (current === bucket ? undefined : bucket))
            }
            aria-pressed={activeBucket === bucket}
            className={`text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${
              activeBucket === bucket
                ? "bg-zinc-900 text-white border-zinc-900"
                : "border-border text-zinc-600 hover:border-zinc-400"
            }`}
          >
            {BUCKET_LABELS[bucket]} {counts[bucket]}
          </button>
        ))}
      </div>

      {shown === 0 ? (
        <p className="text-xs text-zinc-500 py-4 text-center">
          Nothing matches
          {query ? ` “${query.trim()}”` : ""}
          {activeBucket ? ` in ${BUCKET_LABELS[activeBucket]}` : ""}.{" "}
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setActiveBucket(undefined);
            }}
            className="underline hover:text-zinc-800"
          >
            Show all {photos.length}
          </button>
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.key}>
              <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">
                {group.title}
                <span className="ml-1.5 font-normal normal-case tracking-normal text-zinc-400">
                  {group.photos.length}
                </span>
              </p>
              <div className={`grid ${columns} gap-2`}>
                {group.photos.map((photo) => {
                  const state = stateOf?.(photo) ?? null;
                  const tile = (
                    <>
                      <Image
                        src={photo.path}
                        alt={photo.filename}
                        fill
                        sizes="120px"
                        className="object-cover"
                      />
                      {/*
                        The badge is the answer to "is this the large one?" and
                        it is present on every tile in every view — including
                        search results and the All chip, where the grouping
                        headings are gone or mixed. Without that it would only
                        answer the question when the question was already
                        answered by the heading above it.
                      */}
                      <span
                        aria-hidden="true"
                        title={BUCKET_LABELS[photo.bucket]}
                        className="absolute top-1 right-1 z-10 w-4 h-4 rounded text-[9px] font-bold leading-4 text-center bg-black/60 text-white"
                      >
                        {BUCKET_BADGES[photo.bucket]}
                      </span>
                    </>
                  );

                  const ring = state ? STATE_RING[state] : "border-transparent";

                  return (
                    <div key={photo.path} className="flex flex-col gap-1">
                      {onPick ? (
                        <button
                          type="button"
                          onClick={() => onPick(photo)}
                          title={`${photo.filename} — ${BUCKET_LABELS[photo.bucket]}`}
                          aria-label={`${photo.filename}, ${BUCKET_LABELS[photo.bucket]}`}
                          aria-pressed={state !== null}
                          className={`aspect-square relative rounded-lg overflow-hidden border-2 transition-colors ${
                            state ? ring : "border-transparent hover:border-zinc-300"
                          }`}
                        >
                          {tile}
                        </button>
                      ) : (
                        <div
                          title={`${photo.filename} — ${BUCKET_LABELS[photo.bucket]}`}
                          className={`aspect-square relative rounded-xl overflow-hidden border-2 transition-colors ${
                            state ? ring : "border-border"
                          }`}
                        >
                          {tile}
                        </div>
                      )}
                      {renderTileActions?.(photo)}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
