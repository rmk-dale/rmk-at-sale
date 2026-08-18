import Link from "next/link";
import Image from "next/image";
import { Plus, ShoppingBag } from "lucide-react";
import { getAdminProducts, productLabel } from "@/lib/models/product";

/**
 * Inventory list — a Server Component on purpose.
 *
 * This screen displays and never mutates, so nothing here needs to run in
 * the browser. Reading Mongo directly instead of fetching
 * `/api/admin/products` from a `useEffect` removes a whole HTTP request
 * per visit, and with it the `requireAdmin` lookup that request would have
 * performed — three Atlas round trips per navigation become two, which is
 * the difference that matters on a free-tier cluster.
 *
 * It also removes the "Loading inventory…" state entirely: the table is in
 * the first HTML response rather than appearing a round trip later.
 *
 * The protected layout has already run `requireAdmin` and redirected an
 * unauthenticated visitor, and `requireAdmin` is memoised per request, so
 * this page inherits that guard without paying for a second lookup. The
 * read itself is guarded by that same layout — this file must stay inside
 * `(protected)` for that to hold.
 */
export default async function AdminInventoryPage() {
  const products = await getAdminProducts();

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900">Inventory</h1>
        <Link
          href="/admin/products/new"
          className="flex items-center gap-2 bg-zinc-900 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-zinc-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add item
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="text-center py-24 bg-surface rounded-2xl border border-border">
          <p className="text-zinc-500 mb-6">No products yet.</p>
          <Link
            href="/admin/products/new"
            className="inline-flex bg-zinc-900 text-white px-6 py-3 rounded-xl font-medium hover:bg-zinc-700 transition-colors"
          >
            Add your first item
          </Link>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-zinc-500">
                <th className="px-5 py-3 font-medium">Photo</th>
                <th className="px-5 py-3 font-medium">Item Code</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Price</th>
                <th className="px-5 py-3 font-medium">Stock</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr
                  key={product._id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-5 py-3">
                    <div className="w-12 h-12 rounded-lg bg-zinc-50 border border-border relative overflow-hidden flex items-center justify-center">
                      {product.image ? (
                        <Image
                          src={product.image}
                          alt=""
                          fill
                          sizes="48px"
                          className="object-cover"
                        />
                      ) : (
                        <ShoppingBag className="w-5 h-5 text-zinc-300" />
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-zinc-600">
                    {product._id}
                  </td>
                  <td className="px-5 py-3 text-zinc-900">
                    <div className="flex items-center gap-2">
                      {productLabel(product)}
                      {product.featured && (
                        <span className="bg-yellow-100 text-yellow-800 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded">
                          Featured
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-zinc-900">
                    ₱{product.price.toFixed(2)}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        product.stock <= 0
                          ? "bg-red-50 text-red-600"
                          : product.stock <= 5
                            ? "bg-amber-50 text-amber-600"
                            : "bg-emerald-50 text-emerald-600"
                      }`}
                    >
                      {product.stock}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/admin/products/${product._id}`}
                      className="text-zinc-500 hover:text-zinc-900 text-sm font-medium"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
