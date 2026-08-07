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
          <h2 className="text-lg font-semibold text-zinc-900">
            Your cart{" "}
            {items.length > 0 && (
              <span className="text-zinc-400 font-normal">
                ({items.length})
              </span>
            )}
          </h2>
          <button
            onClick={closeCart}
            className="p-2 rounded-full hover:bg-zinc-100 transition-colors"
            aria-label="Close cart"
          >
            <X className="w-5 h-5 text-zinc-600" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3">
              <ShoppingBag className="w-10 h-10 text-zinc-300" />
              <p className="text-zinc-500 text-sm">Your cart is empty.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-zinc-50 rounded-xl border border-border flex-shrink-0 relative overflow-hidden flex items-center justify-center">
                    {item.image ? (
                      <Image
                        src={item.image}
                        alt={item.name}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    ) : (
                      <ShoppingBag className="w-6 h-6 text-zinc-300" />
                    )}
                  </div>

                  <div className="flex-grow min-w-0">
                    <p className="text-sm font-medium text-zinc-900 truncate">
                      {item.name}
                    </p>
                    <p className="text-sm text-zinc-500">
                      ₱{item.price.toFixed(2)}
                    </p>

                    <div className="flex items-center gap-3 mt-2 bg-zinc-50 rounded-full px-3 py-1 border border-border w-fit">
                      <button
                        onClick={() =>
                          updateQuantity(item.id, item.quantity - 1)
                        }
                        className="text-zinc-600 hover:text-zinc-900 transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-4 text-center text-sm font-medium text-zinc-900">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() =>
                          updateQuantity(item.id, item.quantity + 1)
                        }
                        className="text-zinc-600 hover:text-zinc-900 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() => removeItem(item.id)}
                    className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all flex-shrink-0"
                    aria-label="Remove item"
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
              <span className="text-zinc-500">Subtotal</span>
              <span className="text-lg font-semibold text-zinc-900">
                ₱{getTotal().toFixed(2)}
              </span>
            </div>
            <Link
              href="/cart"
              onClick={closeCart}
              className="w-full flex items-center justify-center bg-zinc-900 text-white py-3.5 rounded-xl font-medium hover:bg-zinc-700 transition-all"
            >
              View cart & checkout
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
