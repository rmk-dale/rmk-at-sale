import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/adminGuard';
import AdminLogoutButton from '@/components/admin/AdminLogoutButton';

export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  if (!admin) redirect('/admin/login');

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <nav className="border-b border-border bg-surface">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="font-semibold text-zinc-900">
              rmk-at-sale admin
            </Link>
            <Link href="/admin" className="text-sm text-zinc-600 hover:text-zinc-900 transition-colors">
              Inventory
            </Link>
            <Link href="/admin/orders" className="text-sm text-zinc-600 hover:text-zinc-900 transition-colors">
              Orders
            </Link>
            {admin.role === 'owner' && (
              <Link href="/admin/admins" className="text-sm text-zinc-600 hover:text-zinc-900 transition-colors">
                Admins
              </Link>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-500">
              {admin.username} <span className="text-zinc-300">·</span> {admin.role}
            </span>
            <AdminLogoutButton />
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-6 py-10">{children}</main>
    </div>
  );
}
