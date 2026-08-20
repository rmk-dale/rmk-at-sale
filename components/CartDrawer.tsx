"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useCartStore, evaluateCart, groupCartLines } from "@/lib/store";
import { useCatalog } from "@/lib/useCatalog";
import { useHydrated } from "@/lib/useHydrated";
import CartGroup from "@/components/CartGroup";
import { MIN_UNITS_PER_PRODUCT } from "@/lib/validation";
import { X, ShoppingBag } from "lucide-react";

export default function CartDrawer() {
  const { items, isOpen, closeCart, getTotalItems } = useCartStore();
  /*
    The persisted cart has not been read out of localStorage during the
    server render, so the drawer must render the pre-hydration state or
    React reports a mismatch. `useHydrated` is shared with the cart page
    and the product detail page — see lib/useHydrated.ts for why it is not
    a `useState` plus an effect.
  */
  const hydrated = useHydrated();
  const panelRef = useRef<HTMLDivElement>(null);

  const catalog = useCatalog(isOpen && items.length > 0);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // A panel that covers the page needs a keyboard way out, and focus has
  // to land inside it or a keyboard user is left tabbing the page behind.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCart();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, closeCart]);

  if (!hydrated || !isOpen) return null;

  const totalItems = getTotalItems();
  // Same evaluation as the cart page, so the drawer cannot show a total
  // the page then disagrees with.
  const bundles = evaluateCart(items);
  const groupings = groupCartLines(items);

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop */}
      <div
        onClick={closeCart}
        className="absolute inset-0 bg-black/30 animate-in fade-in duration-200"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
        tabIndex={-1}
        className="absolute top-0 right-0 h-full w-full max-w-md bg-surface border-l border-border flex flex-col animate-in slide-in-from-right duration-300 focus:outline-none"
      >
        <div className="flex items-center justify-between px-6 h-16 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            Your cart{" "}
            {totalItems > 0 && (
              /* Units, not lines. Three of one item used to read "(1)". */
              <span className="text-muted font-normal">({totalItems})</span>
            )}
          </h2>
          <button
            onClick={closeCart}
            className="p-2 rounded-full hover:bg-background transition-colors"
            aria-label="Close cart"
          >
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3">
              <ShoppingBag className="w-10 h-10 text-border" />
              <p className="text-muted text-sm">
                Your cart is empty. Browse the sale to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupings.map((grouping) => (
                <CartGroup
                  key={grouping.id}
                  grouping={grouping}
                  group={bundles.byProduct.get(grouping.id)}
                  product={catalog?.find((p) => p.id === grouping.id)}
                  variant="compact"
                />
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-border px-6 py-6">
            {bundles.discount > 0 && (
              <div className="flex items-center justify-between mb-2 text-sm">
                <span className="text-emerald-700">Bundle discount (5%)</span>
                <span className="text-emerald-700 tabular-nums">
                  −₱{bundles.discount.toFixed(2)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between mb-4">
              <span className="text-muted">Subtotal</span>
              <span className="text-lg font-semibold text-foreground tabular-nums">
                ₱{bundles.total.toFixed(2)}
              </span>
            </div>
            {/*
              The drawer does not block the way the cart page does — it
              links to the cart, and the cart is where the offending line
              can actually be fixed. Saying so here stops the shopper
              discovering the rule one screen later.
            */}
            {!bundles.ok && (
              <p className="text-xs text-primary font-medium mb-3 leading-relaxed">
                Some items are below the {MIN_UNITS_PER_PRODUCT}-piece minimum.
                Adjust them in your cart to check out.
              </p>
            )}
            <Link
              href="/cart"
              onClick={closeCart}
              className="w-full flex items-center justify-center bg-primary text-white py-3.5 rounded-xl font-medium hover:bg-primary-hover transition-all"
            >
              View cart & checkout
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
