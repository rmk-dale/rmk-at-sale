"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useCartStore } from "@/lib/store";
import { Minus, Plus, Trash2, X, ShoppingBag } from "lucide-react";

export default function CartDrawer() {
  const { items, isOpen, closeCart, updateQuantity, removeItem, getTotal } =
    useCartStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop */}
      <div
        onClick={closeCart}
        className="absolute inset-0 bg-black/30 animate-in fade-in duration-200"
      />

      {/* Panel */}
      <div className="absolute top-0 right-0 h-full w-full max-w-md bg-surface border-l border-border flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between px-6 h-16 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            Your cart{" "}
            {items.length > 0 && (
              <span className="text-muted font-normal">({items.length})</span>
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
            <div className="space-y-5">
              {items.map((item) => (
                <div key={item.cartItemId || item.id} className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-background rounded-xl border border-border flex-shrink-0 relative overflow-hidden flex items-center justify-center">
                    {item.image ? (
                      <Image
                        src={item.image}
                        alt={item.name}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    ) : (
                      <ShoppingBag className="w-6 h-6 text-border" />
                    )}
                  </div>

                  <div className="flex-grow min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {item.name}
                    </p>
                    {(item.color || item.size) && (
                      <p className="text-xs text-muted mt-0.5 truncate">
                        {[item.color, item.size].filter(Boolean).join(" | ")}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      {item.originalPrice !== undefined && item.originalPrice > item.price && (
                        <p className="text-xs text-muted line-through tabular-nums">
                          ₱{item.originalPrice.toFixed(2)}
                        </p>
                      )}
                      <p className="text-sm text-primary font-medium tabular-nums">
                        ₱{item.price.toFixed(2)}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 mt-2 bg-background rounded-full px-3 py-1 border border-border w-fit">
                      <button
                        onClick={() =>
                          updateQuantity(item.cartItemId!, item.quantity - 1)
                        }
                        aria-label={`Decrease quantity of ${item.name}`}
                        className="text-muted hover:text-primary transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-4 text-center text-sm font-medium text-foreground tabular-nums">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() =>
                          updateQuantity(item.cartItemId!, item.quantity + 1)
                        }
                        aria-label={`Increase quantity of ${item.name}`}
                        className="text-muted hover:text-primary transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() => removeItem(item.cartItemId!)}
                    className="p-2 text-muted hover:text-primary hover:bg-primary/5 rounded-full transition-all flex-shrink-0"
                    aria-label={`Remove ${item.name} from cart`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-border px-6 py-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-muted">Subtotal</span>
              <span className="text-lg font-semibold text-foreground tabular-nums">
                ₱{getTotal().toFixed(2)}
              </span>
            </div>
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
