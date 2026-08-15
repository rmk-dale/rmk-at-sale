"use client";

import { useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  Check,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { useCartStore, cartLineKey, type CartItem } from "@/lib/store";
import { MAX_QUANTITY_PER_LINE } from "@/lib/validation";
import { resolveVariantImage } from "@/lib/models/product";
import type { PublicProduct } from "@/lib/models/product";

interface CartLineProps {
  item: CartItem;
  /** The line's product as it exists now, if the catalogue has loaded. */
  product?: PublicProduct;
  /** `compact` is the drawer; `full` is the cart page. */
  variant?: "compact" | "full";
}

/**
 * One line of the cart, shared by the drawer and the cart page so the two
 * cannot drift.
 *
 * Beyond layout it does two things the old markup did not: it shows the
 * chosen variant as a swatch and a photo rather than the string
 * "Blue | 55cm", and it lets that choice be changed in place. Picking the
 * wrong size previously meant removing the line and navigating back to the
 * product to start again.
 */
export default function CartLine({
  item,
  product,
  variant = "compact",
}: CartLineProps) {
  const { updateQuantity, removeItem, addItem } = useCartStore();
  const [editing, setEditing] = useState(false);

  const compact = variant === "compact";
  const lineId = item.cartItemId ?? cartLineKey(item.id, item.color, item.size);

  const colorObj = product?.colors?.find((c) => c.name === item.color);
  const currentVariant = product?.variants?.find(
    (v) =>
      (v.color ?? undefined) === (item.color ?? undefined) &&
      (v.size ?? undefined) === (item.size ?? undefined),
  );

  // What the line is worth checking against, once the catalogue is in.
  const liveStock = currentVariant?.stock ?? product?.stock;
  const stale =
    !!product &&
    !!currentVariant &&
    currentVariant.price !== item.price;
  const gone = !!product && product.variants?.length ? !currentVariant : false;
  const overStock = liveStock !== undefined && item.quantity > liveStock;

  const ceiling = Math.min(
    MAX_QUANTITY_PER_LINE,
    liveStock ?? item.variantStock ?? MAX_QUANTITY_PER_LINE,
  );

  const savings =
    item.originalPrice !== undefined && item.originalPrice > item.price
      ? (item.originalPrice - item.price) * item.quantity
      : 0;

  /** Re-keys the line onto a different colour or size, keeping quantity. */
  const switchTo = (nextColor?: string, nextSize?: string) => {
    const next = product?.variants?.find(
      (v) =>
        (v.color ?? undefined) === (nextColor ?? undefined) &&
        (v.size ?? undefined) === (nextSize ?? undefined),
    );
    if (product?.variants?.length && !next) return;

    removeItem(lineId);
    addItem({
      id: item.id,
      name: item.name,
      price: next?.price ?? item.price,
      originalPrice: next?.originalPrice ?? item.originalPrice,
      image: product
        ? resolveVariantImage(product, nextColor, nextSize)
        : item.image,
      quantity: item.quantity,
      color: nextColor,
      size: nextSize,
      variantStock: next?.stock ?? item.variantStock,
    });
    setEditing(false);
  };

  const thumb = compact ? "w-16 h-16" : "w-20 h-20";

  return (
    <div
      className={
        compact
          ? "flex items-start gap-4"
          : "flex flex-col sm:flex-row sm:items-center gap-5 bg-surface p-5 rounded-2xl border border-border"
      }
    >
      <div
        className={`${thumb} bg-background rounded-xl border border-border flex-shrink-0 relative overflow-hidden flex items-center justify-center`}
      >
        {item.image ? (
          <Image
            src={item.image}
            alt={item.name}
            fill
            sizes="80px"
            className="object-cover"
          />
        ) : (
          <ShoppingBag className="w-6 h-6 text-border" />
        )}
      </div>

      <div className="flex-grow min-w-0">
        <p
          className={`font-medium text-foreground ${compact ? "text-sm truncate" : "text-base"}`}
        >
          {item.name}
        </p>

        {/* The variant, shown rather than spelled out. */}
        {(item.color || item.size) && (
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {item.color && (
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <span
                  className="w-3 h-3 rounded-full border border-black/10 shrink-0"
                  style={{ backgroundColor: colorObj?.hex || "#d4d4d8" }}
                />
                {item.color}
              </span>
            )}
            {item.color && item.size && (
              <span className="text-border" aria-hidden="true">
                ·
              </span>
            )}
            {item.size && (
              <span className="text-xs text-muted">{item.size}</span>
            )}
            {product && (product.sizes?.length || product.colors?.length) ? (
              <button
                type="button"
                onClick={() => setEditing((e) => !e)}
                aria-expanded={editing}
                className="text-xs font-medium text-primary hover:underline"
              >
                {editing ? "Done" : "Edit"}
              </button>
            ) : null}
          </div>
        )}

        <div className="flex items-center gap-2 mt-1.5">
          {item.originalPrice !== undefined &&
            item.originalPrice > item.price && (
              <p className="text-xs text-muted line-through tabular-nums">
                ₱{item.originalPrice.toFixed(2)}
              </p>
            )}
          <p className="text-sm text-primary font-medium tabular-nums">
            ₱{item.price.toFixed(2)}
          </p>
          {savings > 0 && (
            <p className="text-xs text-emerald-700 tabular-nums">
              You save ₱{savings.toFixed(2)}
            </p>
          )}
        </div>

        {/* Warnings, only once the catalogue has actually loaded. */}
        {gone && (
          <p className="flex items-center gap-1.5 text-xs text-primary mt-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            This combination is no longer sold. Remove it or pick another.
          </p>
        )}
        {!gone && overStock && (
          <p className="flex items-center gap-1.5 text-xs text-primary mt-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Only {liveStock} left — the quantity will be reduced at checkout.
          </p>
        )}
        {!gone && !overStock && stale && (
          <p className="text-xs text-muted mt-1.5">
            Price has changed to ₱{currentVariant!.price.toFixed(2)} since you
            added this.
          </p>
        )}

        {editing && product && (
          <div className="mt-3 p-3 rounded-xl bg-background border border-border space-y-3">
            {product.colors && product.colors.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
                  Colour
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {product.colors.map((c) => {
                    const isCurrent = c.name === item.color;
                    return (
                      <button
                        key={c.name}
                        type="button"
                        title={c.name}
                        aria-label={c.name}
                        aria-pressed={isCurrent}
                        onClick={() => switchTo(c.name, item.size)}
                        className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors ${
                          isCurrent
                            ? "border-primary"
                            : "border-transparent hover:border-border"
                        }`}
                      >
                        <span
                          className="w-5 h-5 rounded-full border border-black/10 flex items-center justify-center"
                          style={{ backgroundColor: c.hex || "#d4d4d8" }}
                        >
                          {isCurrent && (
                            <Check className="w-3 h-3 text-white mix-blend-difference" />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {product.sizes && product.sizes.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
                  Size
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {product.sizes.map((s) => {
                    const row = product.variants?.find(
                      (v) =>
                        (v.color ?? undefined) === (item.color ?? undefined) &&
                        v.size === s,
                    );
                    const soldOut = !!row && row.stock <= 0;
                    const isCurrent = s === item.size;
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={soldOut}
                        onClick={() => switchTo(item.color, s)}
                        className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                          isCurrent
                            ? "border-primary text-primary bg-primary/5"
                            : "border-border text-muted hover:border-muted"
                        } ${soldOut ? "opacity-40 cursor-not-allowed line-through" : ""}`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {compact && (
          <div className="flex items-center gap-3 mt-2 bg-background rounded-full px-3 py-1 border border-border w-fit">
            <QuantityControls
              item={item}
              lineId={lineId}
              ceiling={ceiling}
              onChange={updateQuantity}
              small
            />
          </div>
        )}
      </div>

      {!compact && (
        <div className="flex items-center gap-4 bg-background rounded-full px-4 py-2 border border-border">
          <QuantityControls
            item={item}
            lineId={lineId}
            ceiling={ceiling}
            onChange={updateQuantity}
          />
        </div>
      )}

      <button
        onClick={() => removeItem(lineId)}
        className={`${compact ? "p-2" : "p-3"} text-muted hover:text-primary hover:bg-primary/5 rounded-full transition-all flex-shrink-0`}
        aria-label={`Remove ${item.name} from cart`}
      >
        <Trash2 className={compact ? "w-4 h-4" : "w-5 h-5"} />
      </button>
    </div>
  );
}

function QuantityControls({
  item,
  lineId,
  ceiling,
  onChange,
  small,
}: {
  item: CartItem;
  lineId: string;
  ceiling: number;
  onChange: (cartItemId: string, quantity: number) => void;
  small?: boolean;
}) {
  const icon = small ? "w-3.5 h-3.5" : "w-4 h-4";
  return (
    <>
      <button
        onClick={() => onChange(lineId, item.quantity - 1)}
        aria-label={`Decrease quantity of ${item.name}`}
        className="text-muted hover:text-primary transition-colors"
      >
        <Minus className={icon} />
      </button>
      <span
        className={`${small ? "w-4 text-sm" : "w-5"} text-center font-medium text-foreground tabular-nums`}
      >
        {item.quantity}
      </span>
      {/* Stops where the order stops being fillable, rather than letting a
          shopper build a cart that checkout will trim. */}
      <button
        onClick={() => onChange(lineId, item.quantity + 1)}
        disabled={item.quantity >= ceiling}
        aria-label={`Increase quantity of ${item.name}`}
        className="text-muted hover:text-primary transition-colors disabled:opacity-30 disabled:hover:text-muted"
      >
        <Plus className={icon} />
      </button>
    </>
  );
}
