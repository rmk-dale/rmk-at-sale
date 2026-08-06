'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useCartStore } from '@/lib/store';
import { ShoppingBag, Plus, ChevronDown } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  image: string;
  hoverImage?: string;
}

type SortOption = 'featured' | 'price-asc' | 'price-desc' | 'name-asc';

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortOption>('featured');
  const [maxPrice, setMaxPrice] = useState(100);
  const addItem = useCartStore((state) => state.addItem);

  useEffect(() => {
    fetch('/api/products')
      .then((res) => res.json())
      .then((data) => {
        setProducts(data);
        setLoading(false);
      });
  }, []);

  const visibleProducts = useMemo(() => {
    const filtered = products.filter((p) => p.price <= maxPrice);
    const sorted = [...filtered];
    if (sort === 'price-asc') sorted.sort((a, b) => a.price - b.price);
    if (sort === 'price-desc') sorted.sort((a, b) => b.price - a.price);
    if (sort === 'name-asc') sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [products, sort, maxPrice]);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-64px)] items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-zinc-900 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-500 text-sm">Loading catalog...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Breadcrumb + sort bar */}
      <div className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-between text-sm">
          <span className="text-zinc-500">Home / Shop all</span>
          <label className="flex items-center gap-1 text-zinc-700">
            Sort by:
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              className="bg-transparent font-medium text-zinc-900 focus:outline-none cursor-pointer appearance-none pr-4"
            >
              <option value="featured">Featured</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="name-asc">Name: A to Z</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 -ml-4 pointer-events-none text-zinc-500" />
          </label>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="mb-10 space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            American Tourister - Sale 
          </h1>
          <p className="text-zinc-500 max-w-2xl">
            Handcrafted goods designed to elevate your everyday workspace.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-10">
          {/* Product grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
            {visibleProducts.map((product) => (
              <Link
                key={product.id}
                href={`/product/${product.id}`}
                className="group flex flex-col min-h-[420px] bg-surface rounded-2xl border border-border overflow-hidden card-hover"
              >
                <div className="aspect-[3/4] w-full relative bg-zinc-50 flex items-center justify-center overflow-hidden">
                  {product.image ? (
                    <>
                      <Image
                        src={product.image}
                        alt={product.name}
                        fill
                        sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
                        className={`object-cover transition-opacity duration-500 ${
                          product.hoverImage ? 'group-hover:opacity-0' : 'group-hover:scale-105'
                        }`}
                      />
                      {product.hoverImage && (
                        <Image
                          src={product.hoverImage}
                          alt={`${product.name} detail`}
                          fill
                          sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
                          className="object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                        />
                      )}
                    </>
                  ) : (
                    <ShoppingBag className="w-14 h-14 text-zinc-300 group-hover:scale-105 group-hover:text-zinc-400 transition-all duration-500" />
                  )}
                </div>

                <div className="p-5 flex flex-col flex-grow">
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <h2 className="text-base font-medium text-zinc-900 leading-tight">
                      {product.name}
                    </h2>
                    <span className="text-zinc-900 font-semibold text-sm whitespace-nowrap">
                      ${product.price.toFixed(2)}
                    </span>
                  </div>

                  <p className="text-zinc-500 text-sm mb-6 flex-grow">
                    {product.description}
                  </p>

                  <button
                    disabled={product.stock <= 0}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      addItem({ ...product, quantity: 1 });
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-zinc-900 text-white py-2.5 rounded-xl font-medium text-sm hover:bg-zinc-700 transition-all duration-300 transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900 disabled:active:scale-100"
                  >
                    <Plus className="w-4 h-4" />
                    {product.stock <= 0 ? 'Out of stock' : 'Add to cart'}
                  </button>
                </div>
              </Link>
            ))}

            {visibleProducts.length === 0 && (
              <div className="col-span-full text-center py-16 text-zinc-500 text-sm">
                No products match the selected filters.
              </div>
            )}
          </div>

          {/* Filters sidebar */}
          <aside className="lg:border-l lg:border-border lg:pl-8 h-fit">
            <h3 className="font-medium text-zinc-900 mb-4">Filters</h3>

            <div className="mb-6">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
                Category
              </p>
              <div className="space-y-2 text-sm text-zinc-700">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="rounded border-border" />
                  Mugs
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="rounded border-border" />
                  Notebooks
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="rounded border-border" />
                  Organizers
                </label>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
                Shop by price
              </p>
              <input
                type="range"
                min={0}
                max={100}
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                className="w-full accent-zinc-900"
              />
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
                <span>$0</span>
                <span>Up to ${maxPrice}</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
