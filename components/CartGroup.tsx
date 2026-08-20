"use client";

import { AlertTriangle, Check } from "lucide-react";
import CartLine from "@/components/CartLine";
import { cartLineId, type CartGrouping } from "@/lib/store";
import {
  BUNDLE_SIZE,
  MIN_UNITS_PER_PRODUCT,
  type BundleGroup,
} from "@/lib/validation";
// Type-only, so nothing from lib/models/product — which imports getDb —
// reaches the client bundle. Same rule as CartLine.
import type { PublicProduct } from "@/lib/models/product";

interface CartGroupProps {
  /** This product's lines, from `groupCartLines`. */
  grouping: CartGrouping;
  /**
   * The bundle standing of the product, counting every line of it in the
   * cart. Absent only for a group whose lines all carry a zero or junk
   * quantity, which `evaluateBundles` drops.
   */
  group?: BundleGroup;
  /** The product as the catalogue has it now, if it has loaded. */
  product?: PublicProduct;
  /** `compact` is the drawer; `full` is the cart page. */
  variant?: "compact" | "full";
}

/**
 * Every line of one product, rendered as a single block.
 *
 * The bundle rules count by product id, but the cart stores a line per
 * colour × size — so the three pieces earning a 5% discount could appear
 * at three separate places in the list with another product between them,
 * and nothing on screen tied them together. This is the container that
 * does: one card per product, its pieces inside it, and one status line
 * naming where that product stands against the rules.
 *
 * It is shared by the drawer and the cart page for the same reason
 * `CartLine` is: two implementations of the same sentence eventually say
 * different things about the same cart.
 */
export default function CartGroup({
  grouping,
  group,
  product,
  variant = "compact",
}: CartGroupProps) {
  const compact = variant === "compact";

  // The catalogue's name wins when it has loaded: a cart persists in
  // localStorage and can outlive the name it was added under.
  const name = product?.name || grouping.name;
  const units = group?.quantity ?? grouping.quantity;
  const pieces = `${units} ${units === 1 ? "piece" : "pieces"}`;

  return (
    <section
      aria-label={`${name} — ${pieces}`}
      className={
        compact
          ? "rounded-xl border border-border bg-background/40 overflow-hidden"
          : "bg-surface border border-border rounded-2xl overflow-hidden"
      }
    >
      <header
        className={`flex items-baseline justify-between gap-3 border-b border-border ${
          compact ? "px-3 py-2.5" : "px-5 py-4"
        }`}
      >
        <p
          className={`font-medium text-foreground min-w-0 truncate ${
            compact ? "text-sm" : "text-base"
          }`}
        >
          {name}
        </p>
        <span
          className={`text-muted tabular-nums shrink-0 ${
            compact ? "text-[11px]" : "text-xs"
          }`}
        >
          {pieces}
          {grouping.lines.length > 1 && ` · ${grouping.lines.length} variants`}
        </span>
      </header>

      {/*
        The group's standing, in one sentence.

        The three states are mutually exclusive by construction: a group is
        below the minimum, at the discount, or between the two. Since the
        discount became a floor rather than an exact count, a group past
        three is simply discounted — there is no longer a state where
        adding a piece takes the 5% away, so nothing here ever asks a
        shopper to buy less.
      */}
      {group && !group.meetsMinimum && (
        <p
          className={`flex items-start gap-1.5 text-xs text-primary font-medium bg-primary/5 border-b border-primary/20 ${
            compact ? "px-3 py-2" : "px-5 py-2.5"
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>
            Minimum {MIN_UNITS_PER_PRODUCT} pieces of this item. Add{" "}
            {group.shortfall} more — any size or colour counts.
          </span>
        </p>
      )}
      {group?.discounted && (
        <p
          className={`flex items-start gap-1.5 text-xs text-emerald-700 font-medium bg-emerald-500/5 border-b border-emerald-600/20 ${
            compact ? "px-3 py-2" : "px-5 py-2.5"
          }`}
        >
          <Check className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>
            Bundle applied — 5% off these {units} pieces, saving ₱
            {group.discount.toFixed(2)}
          </span>
        </p>
      )}
      {group && group.meetsMinimum && !group.discounted && group.toBundle > 0 && (
        <p
          className={`text-xs text-muted border-b border-border ${
            compact ? "px-3 py-2" : "px-5 py-2.5"
          }`}
        >
          Add {group.toBundle} more of this item to reach {BUNDLE_SIZE} and save
          5% on all of them.
        </p>
      )}

      <div className="divide-y divide-border">
        {grouping.lines.map((line) => (
          <div key={cartLineId(line)} className={compact ? "px-3 py-3" : "px-5 py-4"}>
            <CartLine
              item={line}
              product={product}
              variant={variant}
              showName={false}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
