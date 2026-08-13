import { getAdminBrands } from "@/lib/models/brand";
import AddBrandForm from "@/components/admin/AddBrandForm";
import DeleteBrandButton from "@/components/admin/DeleteBrandButton";

/**
 * Brands — server-rendered list, client-side controls.
 *
 * Same reasoning as the inventory page: the list itself is read-only, so
 * it is fetched on the server and shipped as HTML instead of costing a
 * `/api/admin/brands` round trip (and its own `requireAdmin` lookup) on
 * every visit. Only the add form and the delete buttons need to run in the
 * browser, and both hand control back to the server with `router.refresh()`
 * rather than keeping a second copy of the list in React state.
 */
export default async function BrandsPage() {
  const brands = await getAdminBrands();

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900">Brands</h1>
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden mb-8 p-6">
        <h2 className="text-lg font-medium text-zinc-900 mb-4">
          Add a new brand
        </h2>
        <AddBrandForm />
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {brands.length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-zinc-500 text-lg mb-2">No brands found.</p>
            <p className="text-zinc-400 text-sm">
              Add one above to get started.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-zinc-50/50 text-zinc-500 border-b border-border">
              <tr>
                <th className="px-6 py-4 font-medium">Brand Name</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {brands.map((brand) => (
                <tr
                  key={brand.id}
                  className="hover:bg-zinc-50/50 transition-colors"
                >
                  <td className="px-6 py-4 text-zinc-900 font-medium">
                    {brand.name}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <DeleteBrandButton id={brand.id} name={brand.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
