import Link from "next/link";
import Image from "next/image";
import { Plus, ShoppingBag, AlertTriangle, PackageX } from "lucide-react";
import { getAdminProducts, productLabel } from "@/lib/models/product";
import {
  cellLabel,
  productStockAlerts,
  summariseInventory,
  type ProductStockAlerts,
} from "@/lib/stockAlerts";

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
 *
 * The low/out-of-stock surfacing added on top of it costs nothing extra:
 * every count and badge below is derived from the product list this page
 * already had in hand, and the `?filter=` chips narrow that same array
 * rather than issuing a second query. No polling, no `/api/admin/stock`
 * route, no serverless function added — which is the whole reason this
 * shape was chosen over a client-side dashboard.
 */

type StockFilter = "out" | "low";

function parseFilter(value: string | string[] | undefined): StockFilter | null {
  return value === "out" || value === "low" ? value : null;
}

/**
 * The Stock cell.
 *
 * The number shown is `alerts.total`, recomputed from the variant matrix,
 * NOT `product.stock`. For a product with variants the root field is both
 * an aggregate and a stale one — checkout decrements `variants.N.stock`
 * and leaves the root untouched — so it is the wrong number in two ways at
 * once. See the note in lib/stockAlerts.ts.
 *
 * `<details>` rather than a click handler: the breakdown needs no state
 * that the browser cannot keep itself, and reaching for a Client Component
 * here would ship JavaScript for a disclosure triangle.
 */
function StockCell({ alerts }: { alerts: ProductStockAlerts }) {
  const badge = (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium tabular-nums ${
        alerts.worst === "out"
          ? "bg-red-50 text-red-600"
          : alerts.worst === "low"
            ? "bg-amber-50 text-amber-600"
            : "bg-emerald-50 text-emerald-600"
      }`}
    >
      {alerts.total}
    </span>
  );

  const pills = (
    <>
      {alerts.out.length > 0 && (
        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600">
          {alerts.out.length} out
        </span>
      )}
      {alerts.low.length > 0 && (
        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">
          {alerts.low.length} low
        </span>
      )}
    </>
  );

  // A product with no matrix has exactly one cell, and the badge already
  // says everything the breakdown would repeat.
  if (alerts.cellCount <= 1 || (alerts.out.length === 0 && alerts.low.length === 0)) {
    return (
      <div className="flex items-center gap-1.5">
        {badge}
        {alerts.cellCount > 1 && (
          <span className="text-xs text-zinc-400">
            across {alerts.cellCount}
          </span>
        )}
      </div>
    );
  }

  return (
    <details className="group">
      <summary className="flex items-center gap-1.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {badge}
        {pills}
        <span className="text-zinc-300 text-xs group-open:rotate-90 transition-transform">
          ›
        </span>
      </summary>
      <ul className="mt-2 space-y-1">
        {[...alerts.out, ...alerts.low].map((cell) => (
          <li
            key={`${cell.color ?? ""}-${cell.size ?? ""}`}
            className="flex items-center gap-2 text-xs"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                cell.level === "out" ? "bg-red-500" : "bg-amber-500"
              }`}
            />
            <span className="text-zinc-600">{cellLabel(cell)}</span>
            <span className="text-zinc-400 tabular-nums">{cell.stock}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function FilterChip({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        active
          ? "bg-zinc-900 text-white"
          : "bg-white text-zinc-600 border border-border hover:text-zinc-900"
      }`}
    >
      {children}
    </Link>
  );
}

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [products, params] = await Promise.all([
    getAdminProducts(),
    searchParams,
  ]);
  const filter = parseFilter(params.filter);

  // One pass, reused by the banner, the chips and every row: the alerts are
  // computed here rather than inside the row so that filtering and counting
  // cannot disagree with what the badge shows.
  const rows = products.map((product) => ({
    product,
    alerts: productStockAlerts(product),
  }));
  const summary = summariseInventory(products);

  const visible = filter
    ? rows.filter((row) => row.alerts.worst === filter)
    : rows;

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

      {summary.attentionCount > 0 && (
        <div className="mb-6 flex items-center gap-4 flex-wrap bg-amber-50/60 border border-amber-200 rounded-2xl px-5 py-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <p className="text-sm text-zinc-800 flex-1 min-w-[16rem]">
            {summary.outCount > 0 && (
              <strong className="font-semibold">
                {summary.outCount} item{summary.outCount === 1 ? "" : "s"} out of
                stock
              </strong>
            )}
            {summary.outCount > 0 && summary.lowCount > 0 && " · "}
            {summary.lowCount > 0 && (
              <>
                {summary.lowCount} item{summary.lowCount === 1 ? "" : "s"} running
                low
              </>
            )}
            <span className="text-zinc-500">
              {" "}
              — counted per colour and size, not per item total.
            </span>
          </p>
          <div className="flex items-center gap-2">
            <FilterChip active={filter === null} href="/admin">
              All {rows.length}
            </FilterChip>
            {summary.outCount > 0 && (
              <FilterChip active={filter === "out"} href="/admin?filter=out">
                Out {summary.outCount}
              </FilterChip>
            )}
            {summary.lowCount > 0 && (
              <FilterChip active={filter === "low"} href="/admin?filter=low">
                Low {summary.lowCount}
              </FilterChip>
            )}
          </div>
        </div>
      )}

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
      ) : visible.length === 0 ? (
        <div className="text-center py-20 bg-surface rounded-2xl border border-border">
          <PackageX className="w-6 h-6 text-zinc-300 mx-auto mb-3" />
          <p className="text-zinc-500 mb-6">
            Nothing is {filter === "out" ? "out of stock" : "running low"}.
          </p>
          <Link
            href="/admin"
            className="text-sm text-zinc-600 hover:text-zinc-900 font-medium"
          >
            Show all items
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
              {visible.map(({ product, alerts }) => (
                <tr
                  key={product._id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-5 py-3 align-top">
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
                  <td className="px-5 py-3 font-mono text-xs text-zinc-600 align-top">
                    {product._id}
                  </td>
                  <td className="px-5 py-3 text-zinc-900 align-top">
                    <div className="flex items-center gap-2">
                      {productLabel(product)}
                      {product.featured && (
                        <span className="bg-yellow-100 text-yellow-800 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded">
                          Featured
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-zinc-900 align-top">
                    ₱{product.price.toFixed(2)}
                  </td>
                  <td className="px-5 py-3 align-top">
                    <StockCell alerts={alerts} />
                  </td>
                  <td className="px-5 py-3 text-right align-top">
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
