'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useCartStore } from '@/lib/store';
import { ArrowLeft, Minus, Plus, ShoppingBag } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  image: string;
  hoverImage?: string;
}

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    fetch('/api/products')
      .then((res) => res.json())
      .then((data: Product[]) => {
        setProducts(data);
        setLoading(false);
      });
  }, []);

  const product = products.find((p) => p.id === id);

  useEffect(() => {
    if (product) setActiveImage(product.image || null);
  }, [product]);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-64px)] items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-zinc-900 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-500 text-sm">Loading item...</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <p className="text-zinc-500 text-lg mb-6">We couldn&apos;t find that item.</p>
        <Link href="/" className="inline-flex bg-zinc-900 text-white px-6 py-3 rounded-xl font-medium hover:bg-zinc-700 transition-colors">
          Back to shop
        </Link>
      </div>
    );
  }

  const thumbnails = [product.image, product.hoverImage].filter(Boolean) as string[];

  const handleAddToCart = () => {
    for (let i = 0; i < quantity; i++) {
      addItem({ id: product.id, name: product.name, price: product.price, image: product.image, quantity: 1 });
    }
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to shop
      </button>

      <div className="grid lg:grid-cols-2 gap-10">
        {/* Image */}
        <div>
          <div className="aspect-[4/5] w-full relative bg-zinc-50 rounded-2xl border border-border overflow-hidden flex items-center justify-center">
            {activeImage ? (
              <Image
                src={activeImage}
                alt={product.name}
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover"
                priority
              />
            ) : (
              <ShoppingBag className="w-20 h-20 text-zinc-300" />
            )}
          </div>

          {thumbnails.length > 1 && (
            <div className="flex gap-3 mt-4">
              {thumbnails.map((thumb) => (
                <button
                  key={thumb}
                  onClick={() => setActiveImage(thumb)}
                  className={`w-16 h-16 rounded-xl overflow-hidden border relative transition-colors ${
                    activeImage === thumb ? 'border-zinc-900' : 'border-border hover:border-zinc-300'
                  }`}
                >
                  <Image src={thumb} alt="" fill sizes="64px" className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="bg-surface border border-border rounded-2xl p-8">
          <h1 className="text-2xl font-semibold text-zinc-900 mb-1">{product.name}</h1>

          <div className="flex items-center gap-2 mb-6">
            <span className="text-2xl font-semibold text-zinc-900">${product.price.toFixed(2)}</span>
            {product.stock > 0 ? (
              <span className="flex items-center gap-1.5 text-sm text-emerald-600 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Available
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-sm text-red-500 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                Out of stock
              </span>
            )}
          </div>

          <p className="text-zinc-600 leading-relaxed mb-8">{product.description}</p>

          <div className="flex items-center gap-4 mb-6">
            <span className="text-sm font-medium text-zinc-700">Quantity</span>
            <div className="flex items-center gap-4 bg-zinc-50 rounded-full px-4 py-2 border border-border">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="p-1 text-zinc-600 hover:text-zinc-900 transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-4 text-center font-medium text-zinc-900">{quantity}</span>
              <button
                onClick={() => setQuantity((q) => q + 1)}
                className="p-1 text-zinc-600 hover:text-zinc-900 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <button
            disabled={product.stock <= 0}
            onClick={handleAddToCart}
            className="w-full bg-zinc-900 text-white py-3.5 rounded-xl font-medium hover:bg-zinc-700 transition-all transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900 disabled:active:scale-100"
          >
            {product.stock <= 0 ? 'Out of stock' : added ? 'Added to cart' : 'Add to cart'}
          </button>
        </div>
      </div>
    </div>
  );
}
