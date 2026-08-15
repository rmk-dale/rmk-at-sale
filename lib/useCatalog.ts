"use client";

import { useEffect, useState } from "react";
import type { PublicProduct } from "@/lib/models/product";

/**
 * The public catalogue, fetched once per page and shared by every cart line.
 *
 * The cart persists to localStorage, so a line can outlive the product it
 * points at — a price edit, a size withdrawn, stock gone to zero. Holding
 * the catalogue lets each line check itself against current data and lets
 * the variant switcher offer the colours and sizes that actually exist,
 * rather than only what happened to be true when the line was added.
 *
 * The route is CDN-cached and identical for everyone, so this is cheap.
 * Nothing here is a trust boundary: /api/checkout re-reads prices and
 * decrements stock atomically regardless of what this returns.
 */
let catalogPromise: Promise<PublicProduct[]> | null = null;

function loadCatalog(): Promise<PublicProduct[]> {
  catalogPromise ??= fetch("/api/products")
    .then((res) => (res.ok ? res.json() : []))
    .then((data) => (Array.isArray(data) ? (data as PublicProduct[]) : []))
    .catch(() => {
      catalogPromise = null;
      return [];
    });
  return catalogPromise;
}

export function useCatalog(enabled: boolean) {
  const [catalog, setCatalog] = useState<PublicProduct[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadCatalog().then((result) => {
      if (alive) setCatalog(result);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return catalog;
}
