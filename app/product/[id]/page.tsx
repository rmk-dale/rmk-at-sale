import type { Metadata } from "next";
import Link from "next/link";
import { getPublicProductById } from "@/lib/models/product";
import ProductDetail from "@/components/ProductDetail";

/**
 * Product detail — a server component.
 *
 * Previously this downloaded the entire catalog and filtered it in the
 * browser to display one item. Now the server resolves the single product
 * (off the same cached list, so still no extra Atlas query) and ships only
 * that product's data.
 *
 * ISR-cached per path for 15 seconds, and cleared on write by
 * `invalidateProductCaches`. Must stay a literal — see
 * PUBLIC_READ_MAX_AGE_SECONDS in lib/httpCache.ts.
 */
export const revalidate = 15;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = await getPublicProductById(id);
  if (!product) return { title: "Item not found | rmk-at-sale" };
  return {
    title: `${product.name} | rmk-at-sale`,
    description: product.description,
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getPublicProductById(id);

  if (!product) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <p className="text-zinc-500 text-lg mb-6">
          We couldn&apos;t find that item.
        </p>
        <Link
          href="/"
          className="inline-flex bg-zinc-900 text-white px-6 py-3 rounded-xl font-medium hover:bg-zinc-700 transition-colors"
        >
          Back to shop
        </Link>
      </div>
    );
  }

  return <ProductDetail product={product} />;
}
