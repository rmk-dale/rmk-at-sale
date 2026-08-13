"use client";

import Link from "next/link";
import Image from "next/image";
import { ShoppingCart } from "lucide-react";
import { useCartStore } from "@/lib/store";
import { useEffect, useState } from "react";

export default function Navbar() {
  const getTotalItems = useCartStore((state) => state.getTotalItems());
  const toggleCart = useCartStore((state) => state.toggleCart);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    /*
      Solid white, not the old translucent `.glass`. Two reasons: the page
      background is now warm, so an 80%-opaque white bar picked up an
      orange cast and read as off-white rather than white; and dropping the
      rule also drops `backdrop-blur`, which was the most expensive thing
      repainting on every scroll frame on mid-range Android.
    */
    <nav className="fixed top-0 left-0 right-0 z-50 bg-surface border-b border-border">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center group">
          <Image
            src="/rwithtag.png"
            alt="rmk-at-sale"
            width={140}
            height={40}
            className="h-8 w-auto object-contain"
            priority
          />
        </Link>

        <button
          onClick={toggleCart}
          className="relative p-2 rounded-full hover:bg-background transition-colors group flex items-center justify-center"
          aria-label="Open cart"
        >
          <ShoppingCart className="w-5 h-5 text-muted group-hover:text-foreground transition-colors" />
          {mounted && getTotalItems > 0 && (
            <span className="absolute -top-1 -right-1 bg-primary text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full animate-in zoom-in">
              {getTotalItems}
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}
