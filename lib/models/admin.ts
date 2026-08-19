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
  /**
   * Set on exactly one admin at a time: the person who receives an email
   * every time an order is placed. Exclusivity is enforced by the PATCH
   * route, which sets it here and clears it everywhere else inside one
   * transaction — see app/api/admin/admins/[id]/route.ts.
   *
   * Absent on every account created before this field existed, which is
   * why the lookup below matches `true` explicitly.
   */
  notifyOnNewOrder?: boolean;
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
    // Normalised to a boolean so the toggle in the admins table is never
    // driven by `undefined` and can stay a controlled input.
    notifyOnNewOrder: doc.notifyOnNewOrder === true,
    createdAt: doc.createdAt,
  };
}

/**
 * The admin who should be emailed when an order is placed, or null if
 * nobody is assigned.
 *
 * Deliberately NOT cached. This runs once per order, in the `after()` block
 * of the checkout route — after the transaction has committed and after the
 * response has been sent. One `findOne` at order rate is far below anything
 * the M0 ops budget cares about, and a TTL cache would only buy staleness:
 * a per-container cache is invisible to the container that handled the
 * toggle, so an owner reassigning notifications would watch mail keep
 * arriving at the old address for the length of the TTL.
 *
 * `status: "active"` is part of the filter as a second line of defence.
 * Disabling an admin already clears this flag (see the PATCH route), so a
 * disabled account should never match — but if a flag is ever left behind
 * by a direct database edit, a revoked account still does not receive
 * order mail.
 */
export async function getOrderNotifyRecipient(): Promise<{
  email: string;
  username: string;
} | null> {
  const admins = await getAdminsCollection();
  const recipient = await admins.findOne(
    { notifyOnNewOrder: true, status: "active" },
    { projection: { email: 1, username: 1 } },
  );
  if (!recipient) return null;
  return { email: recipient.email, username: recipient.username };
}
