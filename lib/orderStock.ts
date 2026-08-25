import type { AnyBulkWriteOperation, Filter, UpdateFilter } from "mongodb";
import type { ProductDoc, ProductVariant } from "@/lib/models/product";

/**
 * Resolves which stock field an order line with this exact colour/size
 * actually holds units in: the matching cell of the variant matrix if the
 * product has one, otherwise the product's own root `stock` field.
 *
 * Never throws — a mismatch (product deleted, or its variant matrix
 * changed since the line was placed) just resolves to "no variant found",
 * which callers treat as "nothing to credit" rather than an error. A
 * caller that needs to *reserve* more of a line is expected to validate
 * the selection against the live catalogue itself before calling this;
 * this function only locates the field, it doesn't judge whether the
 * selection is still a legitimate one to sell.
 *
 * Extracted so every place that credits or debits inventory for an order
 * line resolves the same way `checkout/route.ts` originally did. Before
 * this existed, the order status-transition route's cancel/reopen paths
 * always touched the product's root `stock` field and never the variant
 * matrix — so cancelling an order for a variant product silently
 * restocked the wrong field. Fixed 2026-08-25; see [[order-items-edit]].
 */
export function resolveOrderLineVariant(
  product: ProductDoc,
  color?: string,
  size?: string,
): { activeVariant: ProductVariant | null; activeVariantIndex: number } {
  if (!product.variants || product.variants.length === 0) {
    return { activeVariant: null, activeVariantIndex: -1 };
  }
  const activeVariantIndex = product.variants.findIndex(
    (v) =>
      (v.color === color || (!v.color && !color)) &&
      (v.size === size || (!v.size && !size)),
  );
  return {
    activeVariant: activeVariantIndex === -1 ? null : product.variants[activeVariantIndex],
    activeVariantIndex,
  };
}

function stockField(activeVariantIndex: number) {
  return `variants.${activeVariantIndex}.stock`;
}

/**
 * Guarded decrement, for taking `amount` more units of a line into an
 * order. The `$gte` is the authoritative check — evaluated by the server
 * at write time, so it can never go negative even off a stale read.
 */
export function stockReserveFilterUpdate(
  itemCode: string,
  activeVariant: ProductVariant | null,
  activeVariantIndex: number,
  amount: number,
  writtenAt: Date,
): { filter: Filter<ProductDoc>; update: UpdateFilter<ProductDoc> } {
  if (activeVariant) {
    return {
      filter: { _id: itemCode, [stockField(activeVariantIndex)]: { $gte: amount } },
      update: {
        $inc: { [stockField(activeVariantIndex)]: -amount },
        $set: { updatedAt: writtenAt },
      },
    };
  }
  return {
    filter: { _id: itemCode, stock: { $gte: amount } },
    update: { $inc: { stock: -amount }, $set: { updatedAt: writtenAt } },
  };
}

/**
 * Unguarded increment, for returning `amount` units of a line to
 * inventory. Releasing stock can't fail on a quantity check the way
 * reserving it can.
 */
export function stockReleaseFilterUpdate(
  itemCode: string,
  activeVariant: ProductVariant | null,
  activeVariantIndex: number,
  amount: number,
  writtenAt: Date,
): { filter: Filter<ProductDoc>; update: UpdateFilter<ProductDoc> } {
  if (activeVariant) {
    return {
      filter: { _id: itemCode },
      update: {
        $inc: { [stockField(activeVariantIndex)]: amount },
        $set: { updatedAt: writtenAt },
      },
    };
  }
  return {
    filter: { _id: itemCode },
    update: { $inc: { stock: amount }, $set: { updatedAt: writtenAt } },
  };
}

/** `stockReserveFilterUpdate`, wrapped for use as one entry in a `bulkWrite`. */
export function buildStockReserveOp(
  itemCode: string,
  activeVariant: ProductVariant | null,
  activeVariantIndex: number,
  amount: number,
  writtenAt: Date,
): AnyBulkWriteOperation<ProductDoc> {
  return {
    updateOne: stockReserveFilterUpdate(itemCode, activeVariant, activeVariantIndex, amount, writtenAt),
  } as AnyBulkWriteOperation<ProductDoc>;
}

/** `stockReleaseFilterUpdate`, wrapped for use as one entry in a `bulkWrite`. */
export function buildStockReleaseOp(
  itemCode: string,
  activeVariant: ProductVariant | null,
  activeVariantIndex: number,
  amount: number,
  writtenAt: Date,
): AnyBulkWriteOperation<ProductDoc> {
  return {
    updateOne: stockReleaseFilterUpdate(itemCode, activeVariant, activeVariantIndex, amount, writtenAt),
  } as AnyBulkWriteOperation<ProductDoc>;
}
