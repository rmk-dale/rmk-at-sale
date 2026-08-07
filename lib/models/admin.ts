import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

export type AdminRole = "owner" | "staff";
export type AdminStatus = "invited" | "active" | "disabled";

export interface AdminDoc {
  _id: ObjectId;
  username: string;
  email: string;
  passwordHash?: string; // absent until the invite is accepted
  role: AdminRole;
  status: AdminStatus;
  twoFactorSecret?: string; // TOTP secret, only set once enrollment is confirmed
  twoFactorEnabled: boolean;
  backupCodeHashes?: string[]; // hashed one-time recovery codes
  /**
   * Failed attempts in the current sign-in sequence, counting BOTH wrong
   * passwords and wrong 2FA codes. Reset only once a session is actually
   * issued — see the note in app/api/admin/auth/login/route.ts.
   */
  failedLoginAttempts: number;
  lockedUntil?: Date;
  /**
   * Highest TOTP time step already accepted for this account. Codes at or
   * below it are refused, so an observed code cannot be replayed inside
   * its validity window.
   */
  lastTotpStep?: number;
  /**
   * Incremented to invalidate every existing session for this admin at
   * once. Bumped on password reset, role change, and disable — see
   * signAdminSession. Absent on accounts created before this existed,
   * which is why every read treats `undefined` as 0.
   */
  sessionEpoch?: number;
  invitedBy?: ObjectId;
  inviteTokenHash?: string; // hash of the current outstanding invite/reset token
  inviteTokenExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

let indexesEnsured = false;

export async function getAdminsCollection() {
  const db = await getDb();
  const collection = db.collection<AdminDoc>("admins");
  if (!indexesEnsured) {
    indexesEnsured = true;
    // createIndex is idempotent — safe to call on every cold start.
    await Promise.all([
      collection.createIndex({ username: 1 }, { unique: true }),
      collection.createIndex({ email: 1 }, { unique: true }),
    ]).catch((err) => console.error("Failed to ensure admin indexes:", err));
  }
  return collection;
}

/** Fields safe to send to the browser — never the hash, secret, or codes. */
export function toPublicAdmin(doc: AdminDoc) {
  return {
    id: doc._id.toString(),
    username: doc.username,
    email: doc.email,
    role: doc.role,
    status: doc.status,
    twoFactorEnabled: doc.twoFactorEnabled,
    createdAt: doc.createdAt,
  };
}
