"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

/**
 * Per-row delete control, so the surrounding table can stay server-rendered.
 *
 * Same refresh-on-success contract as `AddBrandForm`: the server re-renders
 * the list, rather than the client holding its own copy of it.
 */
export default function DeleteBrandButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [isRefreshing, startTransition] = useTransition();

  const busy = deleting || isRefreshing;

  const handleDelete = async () => {
    if (
      !confirm(
        `Delete "${name}"? Products using this brand will still display the brand name until edited.`,
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/brands/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete brand");
      startTransition(() => router.refresh());
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete brand");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={busy}
      className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all disabled:opacity-40"
      title={`Delete ${name}`}
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
