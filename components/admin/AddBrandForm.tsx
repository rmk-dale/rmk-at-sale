"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

/**
 * The write half of the brands screen.
 *
 * Kept as its own client component so the list beside it can stay a
 * Server Component. On success it calls `router.refresh()`, which re-runs
 * the server render and streams down the new list — one request, and no
 * separate client-side fetch of `/api/admin/brands` to keep in sync.
 *
 * `useTransition` is what makes that feel right: `refresh()` is async, so
 * without it the button would re-enable while the old list is still on
 * screen. `pending` stays true until the refreshed list has actually been
 * applied.
 */
export default function AddBrandForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isRefreshing, startTransition] = useTransition();

  const busy = submitting || isRefreshing;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/admin/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add brand");

      setName("");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add brand");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-start gap-4 max-w-md">
      <div className="flex-1">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. American Tourister"
          className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
          disabled={busy}
        />
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      </div>
      <button
        type="submit"
        disabled={!name.trim() || busy}
        className="flex items-center gap-2 bg-zinc-900 text-white px-5 py-2.5 rounded-xl font-medium disabled:opacity-50 hover:bg-zinc-700 transition-colors shrink-0"
      >
        <Plus className="w-4 h-4" />
        {busy ? "Adding..." : "Add brand"}
      </button>
    </form>
  );
}
