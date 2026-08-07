import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/lib/adminAuth";
import { getAdminsCollection, type AdminDoc } from "@/lib/models/admin";

/**
 * Verifies the admin_session cookie AND re-fetches the admin document, so
 * disabling an admin (or changing their role) takes effect immediately on
 * their next request rather than waiting for the signed cookie to expire.
 */
export async function requireAdmin(): Promise<AdminDoc | null> {
  const cookieStore = await cookies();
  const payload = verifyAdminSession(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
  );
  if (!payload) return null;

  // Guard against a malformed id reaching the query as anything other than
  // a literal ObjectId.
  if (!ObjectId.isValid(payload.adminId)) return null;

  const admins = await getAdminsCollection();
  const admin = await admins.findOne({ _id: new ObjectId(payload.adminId) });
  if (!admin || admin.status !== "active") return null;

  // Session revocation. A cookie issued before the account's epoch was
  // bumped — by a password reset, a role change, or an explicit sign-out
  // everywhere — is refused even though its signature is still valid and
  // it has not expired.
  //
  // `?? 0` covers admins created before this field existed: their sessions
  // carry epoch 0 and keep working until something bumps them.
  if ((admin.sessionEpoch ?? 0) !== payload.epoch) return null;

  return admin;
}

/**
 * Invalidates every existing session for an admin by bumping their epoch.
 * Returns the new value, or null if the account is gone.
 */
export async function revokeAdminSessions(
  adminId: ObjectId,
): Promise<number | null> {
  const admins = await getAdminsCollection();
  const updated = await admins.findOneAndUpdate(
    { _id: adminId },
    { $inc: { sessionEpoch: 1 }, $set: { updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return updated?.sessionEpoch ?? null;
}

export async function requireOwner(): Promise<AdminDoc | null> {
  const admin = await requireAdmin();
  if (!admin || admin.role !== "owner") return null;
  return admin;
}
