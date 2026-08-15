"use client";

import { useEffect, useState } from "react";

export interface Photo {
  filename: string;
  path: string;
}

/**
 * One in-flight request for the whole page, shared by every picker.
 *
 * The variant matrix renders a photo field per combination — 3 colours × 4
 * sizes is twelve of them — and each one previously would have fired its
 * own `/api/admin/photos` request on mount. Memoising the promise at module
 * scope means they all await the same fetch. It is never invalidated
 * because the endpoint lists files committed to `public/items/`, which
 * cannot change while the form is open.
 */
let photosPromise: Promise<Photo[]> | null = null;

function loadPhotos(): Promise<Photo[]> {
  photosPromise ??= fetch("/api/admin/photos")
    .then((res) => (res.ok ? res.json() : []))
    .then((data) => (Array.isArray(data) ? (data as Photo[]) : []))
    .catch(() => {
      // Let a failed load be retried by the next mount rather than
      // caching the failure for the life of the page.
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
