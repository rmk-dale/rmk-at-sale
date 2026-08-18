"use client";

import { useEffect, useMemo, useState } from "react";
import RichTextEditor from "@/components/admin/RichTextEditor";
import { isRichTextEmpty, sanitizeRichText } from "@/lib/richText";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import PhotoPicker from "./PhotoPicker";
import ColorVariantEditor from "./ColorVariantEditor";
import SizeTagInput from "./SizeTagInput";
import VariantMatrixEditor from "./VariantMatrixEditor";
import ProductCard from "@/components/ProductCard";
import type { ColorVariant, ProductVariant } from "@/lib/models/product";

export interface ProductFormValues {
  name: string;
  description: string;
  price: number;
  originalPrice?: number;
  stock: number;
  image: string;
  hoverImage?: string;
  brand?: string;
  sizes: string[];
  colors: ColorVariant[];
  variants: ProductVariant[];
  featured: boolean;
}

interface ProductFormProps {
  initial?: Partial<ProductFormValues>;
  submitLabel: string;
  savingLabel: string;
  onSubmit: (values: ProductFormValues) => Promise<void>;
}

function Section({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface border border-border rounded-2xl overflow-hidden">
      <header className="flex items-baseline gap-3 px-6 py-4 border-b border-border bg-zinc-50">
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-900 text-white text-xs font-semibold shrink-0">
          {step}
        </span>
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          {hint && <p className="text-xs text-zinc-500 mt-0.5">{hint}</p>}
        </div>
      </header>
      <div className="p-6 space-y-4">{children}</div>
    </section>
  );
}

function Choice({
  checked,
  onSelect,
  label,
  description,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  description: string;
}) {
  return (
    <label
      className={`flex-1 flex items-start gap-3 border rounded-xl p-3 cursor-pointer transition-colors ${
        checked
          ? "border-zinc-900 bg-zinc-50"
          : "border-border hover:border-zinc-300"
      }`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 accent-zinc-900"
      />
      <span>
        <span className="block text-sm font-medium text-zinc-900">{label}</span>
        <span className="block text-xs text-zinc-500">{description}</span>
      </span>
    </label>
  );
}

const inputClass =
  "w-full bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900";

/**
 * The add and edit screens, which were the same nine fields duplicated
 * across two files.
 *
 * The ordering is the substance of this component. Previously the form
 * opened with a price for a product that had no name yet, hid the price and
 * inventory inputs the moment a size was added (leaving a two-column grid
 * rendering one empty cell), and put "Main display photo" last — below the
 * price matrix, and unable to change anything, because the actual choice
 * was a star button two sections above it.
 *
 * Now it asks four questions in the order you can answer them, and the
 * branches are explicit radios rather than fields that vanish as you type.
 */
export default function ProductForm({
  initial,
  submitLabel,
  savingLabel,
  onSubmit,
}: ProductFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  // Rich-text markup, not plain text. Held raw while typing and sanitized
  // on submit — see the note in RichTextEditor about caret position.
  const [description, setDescription] = useState(initial?.description ?? "");
  const [price, setPrice] = useState(
    initial?.price !== undefined ? String(initial.price) : "",
  );
  const [originalPrice, setOriginalPrice] = useState(
    initial?.originalPrice !== undefined ? String(initial.originalPrice) : "",
  );
  const [stock, setStock] = useState(
    initial?.stock !== undefined ? String(initial.stock) : "",
  );
  const [image, setImage] = useState(initial?.image ?? "");
  const [hoverImage, setHoverImage] = useState(initial?.hoverImage ?? "");
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [sizes, setSizes] = useState<string[]>(initial?.sizes ?? []);
  const [colors, setColors] = useState<ColorVariant[]>(initial?.colors ?? []);
  const [variants, setVariants] = useState<ProductVariant[]>(
    initial?.variants ?? [],
  );
  const [featured, setFeatured] = useState(initial?.featured ?? false);

  // The branch each section is on. Seeded from the data so editing an
  // existing product opens on the right one.
  const [multiColor, setMultiColor] = useState((initial?.colors?.length ?? 0) > 0);
  const [multiSize, setMultiSize] = useState((initial?.sizes?.length ?? 0) > 0);

  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [availableBrands, setAvailableBrands] = useState<
    { id: string; name: string }[]
  >([]);

  useEffect(() => {
    fetch("/api/admin/brands")
      .then((res) => res.json())
      .then((data) => setAvailableBrands(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to fetch brands", err));
  }, []);

  const validColors = useMemo(
    () => colors.filter((c) => c.name.trim() && c.image),
    [colors],
  );
  const defaultColor = useMemo(
    () => validColors.find((c) => c.isDefault) || validColors[0] || null,
    [validColors],
  );

  // With colours present, the storefront's main photo is whichever colour
  // is starred. There is no second control for it.
  const finalImage = defaultColor ? defaultColor.image : image;
  const finalHoverImage = defaultColor ? defaultColor.hoverImage : hoverImage;

  const hasMatrix = validColors.length > 0 || sizes.length > 0;
  const combinationCount =
    validColors.length > 0 && sizes.length > 0
      ? validColors.length * sizes.length
      : Math.max(validColors.length, sizes.length);

  const computedPrice =
    hasMatrix && variants.length > 0
      ? Math.min(...variants.map((v) => v.price))
      : Number(price) || 0;
  const computedStock =
    hasMatrix && variants.length > 0
      ? variants.reduce((s, v) => s + v.stock, 0)
      : Number(stock) || 0;
  const variantOriginalPrices = variants
    .map((v) => v.originalPrice)
    .filter((p): p is number => typeof p === "number");
  const computedOriginalPrice =
    hasMatrix && variantOriginalPrices.length > 0
      ? Math.max(...variantOriginalPrices)
      : originalPrice
        ? Number(originalPrice)
        : undefined;

  const previewProduct = {
    id: "preview",
    name: name || "Untitled item",
    description,
    price: computedPrice,
    originalPrice: computedOriginalPrice,
    stock: computedStock,
    image: finalImage,
    hoverImage: finalHoverImage || undefined,
    brand: brand || undefined,
    sizes,
    colors: validColors,
    variants,
    featured,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const cleanDescription = sanitizeRichText(description);
    // Checked after sanitizing, not before: a field holding only markup we
    // strip (an image, a pasted embed) looks full and saves as empty.
    if (isRichTextEmpty(cleanDescription)) {
      setError("Add a description before saving.");
      return;
    }

    if (!finalImage) {
      setError(
        validColors.length > 0
          ? "Choose a photo for your main-display colour before saving."
          : "Choose a main photo before saving.",
      );
      return;
    }

    // A zero-price variant would be sold for nothing. The matrix seeds new
    // rows at 0, so this is the difference between "not filled in yet" and
    // "free" — worth blocking rather than saving and finding out.
    if (hasMatrix && variants.some((v) => v.price <= 0)) {
      setError(
        "Every combination needs a price above zero. Check section 4 for the rows still marked.",
      );
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: cleanDescription,
        price: computedPrice,
        originalPrice: computedOriginalPrice,
        stock: computedStock,
        image: finalImage,
        hoverImage: finalHoverImage || undefined,
        brand: brand.trim() || undefined,
        sizes,
        colors: validColors,
        variants,
        featured,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Section step={1} title="What is it?">
        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-2">
            Name
          </label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Airconic Spinner 55/20"
            className={inputClass}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-2">
            Description
          </label>
          {/*
            The only place in the catalog that stores formatted text. It is
            rendered on the item detail page and nowhere else — the label
            everything else uses is `name`, one field above.
          */}
          <RichTextEditor
            value={description}
            onChange={setDescription}
            placeholder="Describe the item — sizes, materials, what's included."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-2">
            Collection
          </label>
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className={`${inputClass} appearance-none`}
          >
            <option value="">No collection</option>
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

        <label className="flex items-center gap-3 bg-zinc-50 border border-border rounded-xl p-4 cursor-pointer hover:bg-zinc-100 transition-colors">
          <input
            type="checkbox"
            checked={featured}
            onChange={(e) => setFeatured(e.target.checked)}
            className="w-5 h-5 rounded border-zinc-300 accent-zinc-900"
          />
          <span>
            <span className="block text-sm font-medium text-zinc-900">
              Featured
            </span>
            <span className="block text-xs text-zinc-500">
              Pin to the top of the storefront and rank higher in default
              sorting.
            </span>
          </span>
        </label>
      </Section>

      <Section step={2} title="How does it look?">
        <div className="flex gap-3 flex-col sm:flex-row">
          <Choice
            checked={!multiColor}
            onSelect={() => {
              setMultiColor(false);
              setColors([]);
            }}
            label="One look only"
            description="A single main photo, no colour choice."
          />
          <Choice
            checked={multiColor}
            onSelect={() => setMultiColor(true)}
            label="Multiple colours"
            description="Each colour gets its own photos and swatch."
          />
        </div>

        {multiColor ? (
          <>
            <p className="text-xs text-zinc-500">
              The colour marked <span className="font-medium">Main display</span>{" "}
              supplies the photo shoppers see first, before they pick anything.
            </p>
            <ColorVariantEditor
              initialVariants={colors}
              onChange={setColors}
              defaultImage={image}
              defaultHoverImage={hoverImage}
            />
          </>
        ) : (
          <PhotoPicker
            image={image}
            hoverImage={hoverImage}
            onChangeImage={setImage}
            onChangeHoverImage={setHoverImage}
          />
        )}
      </Section>

      <Section step={3} title="Does it come in different sizes?">
        <div className="flex gap-3 flex-col sm:flex-row">
          <Choice
            checked={!multiSize}
            onSelect={() => {
              setMultiSize(false);
              setSizes([]);
            }}
            label="One size only"
            description="No size choice on the product page."
          />
          <Choice
            checked={multiSize}
            onSelect={() => setMultiSize(true)}
            label="Multiple sizes"
            description="The same sizes apply to every colour."
          />
        </div>

        {multiSize && (
          <>
            <SizeTagInput sizes={sizes} onChange={setSizes} />
            {/*
              The signpost that was missing. Adding a size used to make the
              price matrix appear from nowhere; now section 3 says what it
              just created and where it gets filled in.
            */}
            {combinationCount > 0 && (
              <p className="text-xs text-zinc-500">
                {validColors.length > 0
                  ? `${validColors.length} colour${validColors.length === 1 ? "" : "s"} × ${sizes.length} size${sizes.length === 1 ? "" : "s"} = ${combinationCount} combinations.`
                  : `${combinationCount} combination${combinationCount === 1 ? "" : "s"}.`}{" "}
                Set each one&apos;s photo, price and stock in section 4.
              </p>
            )}
          </>
        )}
      </Section>

      <Section
        step={4}
        title={
          hasMatrix ? "Photo, price and stock for each combination" : "Price and stock"
        }
        hint={
          hasMatrix
            ? "A photo here is that colour at that size — it replaces the main photo once a shopper picks both."
            : undefined
        }
      >
        {hasMatrix ? (
          <VariantMatrixEditor
            colors={validColors}
            sizes={sizes}
            variants={variants}
            onChange={setVariants}
          />
        ) : (
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-600 mb-2">
                Original price
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={originalPrice}
                onChange={(e) => setOriginalPrice(e.target.value)}
                placeholder="0.00"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-600 mb-2">
                Discounted price
              </label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={inputClass}
              />
            </div>
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
                className={inputClass}
              />
            </div>
          </div>
        )}
      </Section>

      {/*
        The storefront card, rendered from the values currently in the form.
        Without it the only way to see the effect of an edit is to save,
        navigate to the shop and look — which is most of why this form was
        hard to reason about.
      */}
      <section className="bg-surface border border-border rounded-2xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowPreview((p) => !p)}
          aria-expanded={showPreview}
          className="w-full flex items-center justify-between px-6 py-4 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 transition-colors"
        >
          Preview the storefront card
          <span className="text-xs font-normal text-zinc-500">
            {showPreview ? "Hide" : "Show"}
          </span>
        </button>
        {showPreview && (
          <div className="px-6 pb-6 pt-2 bg-background">
            {finalImage ? (
              /*
                Inert on purpose. The card's title is a link that stretches
                over the whole card, so a stray click inside the preview
                would navigate to /product/preview and take every unsaved
                field with it.
              */
              <div
                className="max-w-xs pointer-events-none select-none"
                aria-hidden="true"
              >
                <ProductCard product={previewProduct} onAddToCart={() => {}} />
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-zinc-500 py-6">
                <ImageOff className="w-4 h-4" />
                Choose a photo in section 2 to see the card.
              </p>
            )}
          </div>
        )}
      </section>

      {finalImage && (
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <div className="w-9 h-9 rounded-lg overflow-hidden border border-border relative shrink-0">
            <Image
              src={finalImage}
              alt=""
              fill
              sizes="36px"
              className="object-cover"
            />
          </div>
          Main display photo
          {defaultColor ? ` — from ${defaultColor.name}` : ""}
        </div>
      )}

      {error && (
        <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      <button
        disabled={saving}
        type="submit"
        className="w-full bg-zinc-900 text-white py-3 rounded-xl font-medium disabled:opacity-50 hover:bg-zinc-700 transition-colors"
      >
        {saving ? savingLabel : submitLabel}
      </button>
    </form>
  );
}
