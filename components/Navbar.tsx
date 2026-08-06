'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ShoppingCart } from 'lucide-react';
import { useCartStore } from '@/lib/store';
import { useEffect, useState } from 'react';

export default function Navbar() {
  const getTotalItems = useCartStore((state) => state.getTotalItems());
  const toggleCart = useCartStore((state) => state.toggleCart);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass">
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
          className="relative p-2 rounded-full hover:bg-zinc-100 transition-colors group flex items-center justify-center"
          aria-label="Open cart"
        >
          <ShoppingCart className="w-5 h-5 text-zinc-700 group-hover:text-zinc-900 transition-colors" />
          {mounted && getTotalItems > 0 && (
            <span className="absolute -top-1 -right-1 bg-zinc-900 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full animate-in zoom-in">
              {getTotalItems}
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}
