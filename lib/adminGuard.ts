import { cookies } from 'next/headers';
import { ObjectId } from 'mongodb';
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from '@/lib/adminAuth';
import { getAdminsCollection, type AdminDoc } from '@/lib/models/admin';

/**
 * Verifies the admin_session cookie AND re-fetches the admin document, so
 * disabling an admin (or changing their role) takes effect immediately on
 * their next request rather than waiting for the signed cookie to expire.
 */
export async function requireAdmin(): Promise<AdminDoc | null> {
  const cookieStore = await cookies();
  const payload = verifyAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  if (!payload) return null;

  const admins = await getAdminsCollection();
  const admin = await admins.findOne({ _id: new ObjectId(payload.adminId) });
  if (!admin || admin.status !== 'active') return null;

  return admin;
}

export async function requireOwner(): Promise<AdminDoc | null> {
  const admin = await requireAdmin();
  if (!admin || admin.role !== 'owner') return null;
  return admin;
}
