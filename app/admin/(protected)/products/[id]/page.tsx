"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ProductForm, {
  type ProductFormValues,
} from "@/components/admin/ProductForm";
import type { ColorVariant, ProductVariant } from "@/lib/models/product";
import { richTextToPlain, toRichText } from "@/lib/richText";

interface AdminProduct {
  _id: string;
  name?: string;
  description: string;
  price: number;
  originalPrice?: number;
  stock: number;
  image: string;
  hoverImage?: string;
  brand?: string;
  sizes?: string[];
  colors?: ColorVariant[];
  variants?: ProductVariant[];
  featured?: boolean;
}

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [initial, setInitial] = useState<Partial<ProductFormValues>>();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/admin/products/${encodeURIComponent(id)}`,
        );
        if (cancelled) return;

        if (!res.ok) {
          setNotFound(true);
          return;
        }

        const product: AdminProduct = await res.json();
        if (cancelled) return;

        setInitial({
          // `richTextToPlain`, not `productLabel` — that helper lives in
          // lib/models/product.ts, which pulls in the MongoDB driver and
          // cannot be imported by value from a client component.
          name: product.name || richTextToPlain(product.description) || "",
          description: toRichText(product.description),
          price: product.price,
          originalPrice: product.originalPrice,
          stock: product.stock,
          image: product.image || "",
          hoverImage: product.hoverImage || "",
          brand: product.brand || "",
          sizes: product.sizes || [],
          colors: product.colors || [],
          variants: product.variants || [],
          featured: product.featured || false,
        });
      } catch (err) {
        console.error("Failed to load product", err);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleSubmit = async (values: ProductFormValues) => {
    const res = await fetch(`/api/admin/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save changes");
    // See the note in products/new: the list is server-rendered, so the
    // edit is invisible unless the router cache is cleared first.
    router.refresh();
    router.push("/admin");
  };

  if (loading) return <p className="text-zinc-500 text-sm">Loading…</p>;

  if (notFound) {
    return (
      <div>
        <p className="text-zinc-500 mb-6">Item {id} not found.</p>
        <Link href="/admin" className="text-zinc-900 font-medium">
          Back to inventory
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin"
        className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to inventory
      </Link>

      <h1 className="text-2xl font-semibold text-zinc-900 mb-8">Edit item</h1>

      {/*
        Mounted only once the product has loaded. ColorVariantEditor seeds
        its internal rows from `initialVariants` on first render, so
        rendering the form against empty data and filling it in later would
        leave the colour editor permanently blank.
      */}
      <ProductForm
        initial={initial}
        submitLabel="Save changes"
        savingLabel="Saving…"
        onSubmit={handleSubmit}
      />
    </div>
  );
}
