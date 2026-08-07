"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ImageOff } from "lucide-react";
import PhotoPicker from "@/components/admin/PhotoPicker";
import ColorVariantEditor from "@/components/admin/ColorVariantEditor";
import SizeTagInput from "@/components/admin/SizeTagInput";
import type { ColorVariant } from "@/lib/models/product";

interface AdminProduct {
  _id: string;
  name?: string;
  description: string;
  price: number;
  stock: number;
  image: string;
  hoverImage?: string;
  brand?: string;
  sizes?: string[];
  colors?: ColorVariant[];
  featured?: boolean;
}

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [itemCode, setItemCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [image, setImage] = useState("");
  const [hoverImage, setHoverImage] = useState("");
  const [brand, setBrand] = useState("");
  const [sizes, setSizes] = useState<string[]>([]);
  const [colors, setColors] = useState<ColorVariant[]>([]);
  const [featured, setFeatured] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [availableBrands, setAvailableBrands] = useState<{id: string, name: string}[]>([]);

  useEffect(() => {
    fetch("/api/admin/brands")
      .then((res) => res.json())
      .then((data) => {
        setAvailableBrands(Array.isArray(data) ? data : []);
      })
      .catch((err) => console.error("Failed to fetch brands", err));
  }, []);

  useEffect(() => {
    fetch("/api/admin/products")
      .then((res) => res.json())
      .then((data: AdminProduct[]) => {
        const product = data.find((p) => p._id === id);
        if (!product) {
          setNotFound(true);
        } else {
          setItemCode(product._id);
          setName(product.name || product.description || "");
          setDescription(product.description);
          setPrice(String(product.price));
          setStock(String(product.stock));
          setImage(product.image || "");
          setHoverImage(product.hoverImage || "");
          setBrand(product.brand || "");
          setSizes(product.sizes || []);
          setColors(product.colors || []);
          setFeatured(product.featured || false);
        }
        setLoading(false);
      });
  }, [id]);

  const validColors = colors.filter((c) => c.name.trim() && c.image);
  const defaultColor = useMemo(
    () => validColors.find((c) => c.isDefault) || validColors[0] || null,
    [validColors],
  );
  // Once colors exist, the main display photo comes from whichever color is
  // marked as default — the standalone photo picker below is only used for
  // items that don't have color variants at all.
  const finalImage = defaultColor ? defaultColor.image : image;
  const finalHoverImage = defaultColor ? defaultColor.hoverImage : hoverImage;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!finalImage) {
      setError(
        validColors.length > 0
          ? "Choose a photo for your main-display color before saving."
          : "Choose a main photo before saving.",
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newItemCode: itemCode.trim(),
          name: name.trim(),
          description: description.trim(),
          price: Number(price),
          stock: Number(stock),
          image: finalImage,
          hoverImage: finalHoverImage || undefined,
          brand: brand.trim() || undefined,
          sizes,
          colors: validColors,
          featured,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save changes");
      router.push("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
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

      <h1 className="text-2xl font-semibold text-zinc-900 mb-1">Edit item</h1>
      <p className="text-sm text-zinc-500 font-mono mb-8">{id}</p>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 bg-surface border border-border rounded-2xl p-8"
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-2">
              Item Code
            </label>
            <input
              required
              value={itemCode}
              onChange={(e) => setItemCode(e.target.value)}
              className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-2">
              Regular price
            </label>
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-2">
              Inventory
            </label>
            <input
              required
              type="number"
              min="0"
              step="1"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-2">
            Name
          </label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-2">
            Description
          </label>
          <textarea
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-2">
            Brand
          </label>
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 appearance-none"
          >
            <option value="">No brand</option>
            {availableBrands.map((b) => (
              <option key={b.id} value={b.name}>
                {b.name}
              </option>
            ))}
            {brand && !availableBrands.some((b) => b.name === brand) && (
              <option value={brand}>{brand} (Legacy)</option>
            )}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-2">
            Sizes
          </label>
          <SizeTagInput sizes={sizes} onChange={setSizes} />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-2">
            Colors
          </label>
          <p className="text-xs text-zinc-500 mb-3">
            Each color can have its own main and hover photo — these swap in
            on the product card and item page when a shopper picks that
            color. Optional: skip this if the item doesn&apos;t come in
            multiple colors.
          </p>
          <ColorVariantEditor
            initialVariants={colors}
            onChange={setColors}
            defaultImage={image}
            defaultHoverImage={hoverImage}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-2">
            Main display photo
          </label>
          {validColors.length > 0 ? (
            <div className="flex items-center gap-3 bg-zinc-50 border border-border rounded-xl p-3">
              <div className="w-14 h-14 rounded-lg overflow-hidden border border-border relative shrink-0 bg-white flex items-center justify-center">
                {finalImage ? (
                  <Image
                    src={finalImage}
                    alt="Main display"
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                ) : (
                  <ImageOff className="w-5 h-5 text-zinc-300" />
                )}
              </div>
              <p className="text-sm text-zinc-600">
                Using{" "}
                <span className="font-medium text-zinc-900">
                  {defaultColor?.name || "the main-display color"}
                </span>
                &apos;s photo. Change which color is used by marking a
                different one &quot;Set as main display&quot; above.
              </p>
            </div>
          ) : (
            <PhotoPicker
              image={image}
              hoverImage={hoverImage}
              onChangeImage={setImage}
              onChangeHoverImage={setHoverImage}
            />
          )}
        </div>

        <div>
          <label className="flex items-center gap-3 bg-zinc-50 border border-border rounded-xl p-4 cursor-pointer hover:bg-zinc-100 transition-colors">
            <input
              type="checkbox"
              checked={featured}
              onChange={(e) => setFeatured(e.target.checked)}
              className="w-5 h-5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
            />
            <div>
              <p className="text-sm font-medium text-zinc-900">Featured Product</p>
              <p className="text-xs text-zinc-500">Highlight this item on the storefront and rank it higher in default sorting.</p>
            </div>
          </label>
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button
          disabled={saving}
          type="submit"
          className="w-full bg-zinc-900 text-white py-3 rounded-xl font-medium disabled:opacity-50 hover:bg-zinc-700 transition-colors"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
