import type { ProductDoc } from "@/lib/models/product";

/**
 * Stock-level classification for the admin Inventory screen.
 *
 * Deliberately a pure module: it imports only a `type` from
 * `lib/models/product`, which erases at compile time, so nothing here pulls
 * the MongoDB driver into a bundle. That is what lets a Client Component
 * import `stockLevel` for a badge without breaking the build — see
 * [[client-server-boundary]] for the failure this avoids.
 */

/**
 * At or below this many units, a sellable cell is "running low".
 *
 * Previously a bare `<= 5` inlined in the Inventory page's JSX. Named here
 * so the table, the summary banner and the nav badge cannot drift apart,
 * and so there is one line to change when the shop wants a different
 * number.
 *
 * Flat across the catalogue on purpose. A per-product override is the
 * obvious refinement — a 12-cell matrix holding 3 units per cell is 36
 * units and not remotely low — but it is additive (an optional field,
 * absent reads as this default) and can land later without a migration.
 */
export const LOW_STOCK_THRESHOLD = 5;

export type StockLevel = "out" | "low" | "ok";

export function stockLevel(units: number): StockLevel {
  if (units <= 0) return "out";
  if (units <= LOW_STOCK_THRESHOLD) return "low";
  return "ok";
}

/** One sellable cell that needs attention: a variant, or a whole product. */
export interface StockAlertCell {
  color?: string;
  size?: string;
  stock: number;
  level: "out" | "low";
}

export interface ProductStockAlerts {
  /** The most severe level present. "out" if ANY cell is out. */
  worst: StockLevel;
  out: StockAlertCell[];
  low: StockAlertCell[];
  /** Units actually sellable right now, summed across cells. */
  total: number;
  /** 1 for a plain product, one per colour x size combination otherwise. */
  cellCount: number;
}

/**
 * Which parts of a product are out or running low.
 *
 * The important thing this does is IGNORE `product.stock` whenever a
 * variant matrix exists, and there are two independent reasons for that.
 *
 * 1. Root `stock` is an aggregate. A product holding 40 units spread over
 *    twelve colour/size cells can be completely sold out in Sporty Blue /
 *    55cm, and a threshold applied to 40 will never say so. The shopper
 *    finds out at checkout; the shop finds out from the shopper.
 *
 * 2. Root `stock` is also STALE for those products. `lib/orderStock.ts`
 *    decrements `variants.N.stock` for a variant line and never touches the
 *    root field, so after any sale the number is whatever
 *    `ProductForm`'s `computedStock` last summed and wrote. It re-syncs
 *    only when an admin next saves the product.
 *
 * So `total` here is recomputed from the cells rather than read off the
 * document. For a product with no matrix, root `stock` IS the live field
 * that checkout decrements, and is used directly.
 *
 * Takes the narrowest shape it needs rather than a whole `ProductDoc`, so
 * a caller holding a partial projection can still use it.
 */
export function productStockAlerts(
  product: Pick<ProductDoc, "stock" | "variants">,
): ProductStockAlerts {
  const cells: Array<{ color?: string; size?: string; stock: number }> =
    product.variants && product.variants.length > 0
      ? product.variants.map((v) => ({
          color: v.color,
          size: v.size,
          stock: v.stock,
        }))
      : [{ stock: product.stock }];

  const out: StockAlertCell[] = [];
  const low: StockAlertCell[] = [];
  let total = 0;

  for (const cell of cells) {
    total += cell.stock;
    const level = stockLevel(cell.stock);
    if (level === "ok") continue;
    (level === "out" ? out : low).push({ ...cell, level });
  }

  return {
    worst: out.length > 0 ? "out" : low.length > 0 ? "low" : "ok",
    out,
    low,
    total,
    cellCount: cells.length,
  };
}

/**
 * How a cell reads in a badge: "Sporty Blue / 55cm", or just one of them,
 * or "All stock" for a product with no matrix at all.
 */
export function cellLabel(cell: Pick<StockAlertCell, "color" | "size">): string {
  const parts = [cell.color, cell.size].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "All stock";
}

export interface InventorySummary {
  outCount: number;
  lowCount: number;
  /** outCount + lowCount — what the nav badge shows. */
  attentionCount: number;
}

/**
 * Catalogue-wide counts for the banner and the nav badge.
 *
 * Counts PRODUCTS, not cells, because that is what the row-per-product
 * table below it can actually filter down to. A product with four sold-out
 * colours is one item needing attention, not four.
 *
 * A product is counted once, at its worst level: anything with an
 * out-of-stock cell is "out" even if it also has low cells, so the two
 * counts never double-count the same row.
 */
export function summariseInventory(
  products: Array<Pick<ProductDoc, "stock" | "variants">>,
): InventorySummary {
  let outCount = 0;
  let lowCount = 0;
  for (const product of products) {
    const worst = productStockAlerts(product).worst;
    if (worst === "out") outCount += 1;
    else if (worst === "low") lowCount += 1;
  }
  return { outCount, lowCount, attentionCount: outCount + lowCount };
}
