"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

interface PublicBrand {
  id: string;
  name: string;
}

export default function BrandsPage() {
  const [brands, setBrands] = useState<PublicBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBrandName, setNewBrandName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const fetchBrands = () => {
    setLoading(true);
    fetch("/api/admin/brands")
      .then((res) => res.json())
      .then((data: PublicBrand[]) => {
        setBrands(Array.isArray(data) ? data : []);
      })
      .catch((err) => console.error("Failed to fetch brands", err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchBrands();
  }, []);

  const handleAddBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBrandName.trim()) return;
    setAdding(true);
    setError("");

    try {
      const res = await fetch("/api/admin/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newBrandName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add brand");
      
      setNewBrandName("");
      fetchBrands();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteBrand = async (id: string) => {
    if (!confirm("Are you sure you want to delete this brand? Products using this brand will still display the brand name until edited.")) {
      return;
    }
    
    try {
      const res = await fetch(`/api/admin/brands/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete brand");
      
      fetchBrands();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900">Brands</h1>
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden mb-8 p-6">
        <h2 className="text-lg font-medium text-zinc-900 mb-4">Add a new brand</h2>
        <form onSubmit={handleAddBrand} className="flex items-start gap-4 max-w-md">
          <div className="flex-1">
            <input
              type="text"
              value={newBrandName}
              onChange={(e) => setNewBrandName(e.target.value)}
              placeholder="e.g. American Tourister"
              className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
              disabled={adding}
            />
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
          </div>
          <button
            type="submit"
            disabled={!newBrandName.trim() || adding}
            className="flex items-center gap-2 bg-zinc-900 text-white px-5 py-2.5 rounded-xl font-medium disabled:opacity-50 hover:bg-zinc-700 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            {adding ? "Adding..." : "Add brand"}
          </button>
        </form>
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-zinc-500">Loading brands...</div>
        ) : brands.length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-zinc-500 text-lg mb-2">No brands found.</p>
            <p className="text-zinc-400 text-sm">Add one above to get started.</p>
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
                <tr key={brand.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4 text-zinc-900 font-medium">
                    {brand.name}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleDeleteBrand(brand.id)}
                      className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                      title="Delete brand"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
