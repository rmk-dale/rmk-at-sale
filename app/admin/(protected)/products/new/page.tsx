"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ProductForm, {
  type ProductFormValues,
} from "@/components/admin/ProductForm";

export default function NewProductPage() {
  const router = useRouter();

  const handleSubmit = async (values: ProductFormValues) => {
    const res = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to add item");
    // The inventory list is server-rendered, so the new item only shows up
    // if the client router drops whatever it already holds for /admin.
    // `refresh` before `push` so the navigation lands on freshly rendered
    // HTML instead of a cached payload that predates this save.
    router.refresh();
    router.push("/admin");
  };

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin"
        className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to inventory
      </Link>

      <h1 className="text-2xl font-semibold text-zinc-900 mb-8">Add item</h1>

      <ProductForm
        submitLabel="Add item"
        savingLabel="Saving…"
        onSubmit={handleSubmit}
      />
    </div>
  );
}
