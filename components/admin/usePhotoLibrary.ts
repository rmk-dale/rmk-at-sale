"use client";

import { useEffect, useState } from "react";
import type { PhotoBucket } from "@/lib/photoBuckets";

export interface Photo {
  filename: string;
  path: string;
  /** Which size folder the file sits in. Derived server-side, never stored. */
  bucket: PhotoBucket;
  /** Directory below public/items, "" at the top level. */
  dir: string;
}

/**
 * One in-flight request for the whole page, shared by every picker.
 *
 * The variant matrix renders two photo fields per combination — 3 colours × 4
 * sizes is twenty-four of them — and each one would otherwise fire its own
 * `/api/admin/photos` request on mount. Memoising the promise at module scope
 * means they all await the same fetch. It is never invalidated because the
 * endpoint lists files committed to `public/items/`, which cannot change while
 * the form is open.
 */
let photosPromise: Promise<Photo[]> | null = null;

/**
 * Tolerates a payload from before the endpoint reported folders.
 *
 * A deploy can serve a cached page whose JS is newer than the route it calls,
 * or older; either way a photo with no `bucket` must still be selectable. It
 * lands in `other`, which every consumer already renders as "Unfiled" rather
 * than treating as a missing value.
 */
function normalize(data: unknown): Photo[] {
  if (!Array.isArray(data)) return [];
  const out: Photo[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue;
    const { filename, path, bucket, dir } = entry as Record<string, unknown>;
    if (typeof filename !== "string" || typeof path !== "string") continue;
    out.push({
      filename,
      path,
      bucket:
        bucket === "small" || bucket === "medium" || bucket === "large"
          ? bucket
          : "other",
      dir: typeof dir === "string" ? dir : "",
    });
  }
  return out;
}

function loadPhotos(): Promise<Photo[]> {
  photosPromise ??= fetch("/api/admin/photos")
    .then((res) => (res.ok ? res.json() : []))
    .then(normalize)
    .catch(() => {
      // Let a failed load be retried by the next mount rather than caching
      // the failure for the life of the page.
      photosPromise = null;
      return [];
    });
  return photosPromise;
}

export function usePhotoLibrary() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    loadPhotos().then((result) => {
      if (!alive) return;
      setPhotos(result);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { photos, loading };
}
