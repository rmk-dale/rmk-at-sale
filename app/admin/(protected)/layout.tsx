import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { requireAdmin } from "@/lib/adminGuard";
import AdminLogoutButton from "@/components/admin/AdminLogoutButton";
import { getAdminProducts } from "@/lib/models/product";
import { summariseInventory } from "@/lib/stockAlerts";

export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin/login");

  // The count lives in the layout rather than on the Inventory page so it
  // is visible from Orders, Collections and the rest — a badge you can
  // only see once you have already navigated to the screen it describes is
  // not telling anyone anything.
  //
  // This is cheap because `getAdminProducts` is the same per-container
  // TTL cache the Inventory page reads, and the Inventory page renders
  // inside this layout: on that route the two calls collapse to one Atlas
  // query, and on every other admin route it is a cache hit for the
  // length of the TTL. Worst case is one extra `find` per container per
  // 10 seconds, which the M0 ops budget does not notice.
  //
  // Failure here must not take down the admin panel: an unreachable Atlas
  // should cost the badge, not every page behind this layout.
  let attentionCount = 0;
  try {
    attentionCount = summariseInventory(await getAdminProducts()).attentionCount;
  } catch (err) {
    console.error("[admin] Could not compute the inventory badge:", err);
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <nav className="border-b border-border bg-surface">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="flex items-center group">
              <Image
                src="/rwithtag.png"
                alt="rmk-at-sale"
                width={140}
                height={40}
                className="h-8 w-auto object-contain"
                priority
              />
            </Link>
            <Link
              href="/admin"
              className="text-sm text-zinc-600 hover:text-zinc-900 transition-colors flex items-center gap-1.5"
            >
              Inventory
              {attentionCount > 0 && (
                <span
                  className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums"
                  title={`${attentionCount} item${attentionCount === 1 ? "" : "s"} out of stock or running low`}
                >
                  {attentionCount}
                </span>
              )}
            </Link>
            <Link
              href="/admin/orders"
              className="text-sm text-zinc-600 hover:text-zinc-900 transition-colors"
            >
              Orders
            </Link>
            <Link
              href="/admin/brands"
              className="text-sm text-zinc-600 hover:text-zinc-900 transition-colors"
            >
              Collections
            </Link>
            {admin.role === "owner" && (
              <>
                <Link
                  href="/admin/admins"
                  className="text-sm text-zinc-600 hover:text-zinc-900 transition-colors"
                >
                  Admins
                </Link>
                <Link
                  href="/admin/audit"
                  className="text-sm text-zinc-600 hover:text-zinc-900 transition-colors"
                >
                  Activity
                </Link>
                <Link
                  href="/admin/performance"
                  className="text-sm text-zinc-600 hover:text-zinc-900 transition-colors"
                >
                  Performance
                </Link>
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-500">
              {admin.username} <span className="text-zinc-300">·</span>{" "}
              {admin.role}
            </span>
            <AdminLogoutButton />
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-6 py-10">{children}</main>
    </div>
  );
}
