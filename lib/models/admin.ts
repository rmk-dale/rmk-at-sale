import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

export type AdminRole = "owner" | "staff";
export type AdminStatus = "invited" | "active" | "disabled";

/**
 * How many admins may be assigned order notifications at once.
 *
 * A cap rather than "everyone who wants it" on purpose: every recipient is
 * one more address on a mail that goes out on every single order, and a
 * fixed small number keeps the Admins tab honest about who is actually
 * watching the inbox. Three is the number the shop asked for; raising it
 * is a one-line change here, but read the transaction in the PATCH route
 * first — the cap is what makes that write worth serialising.
 */
export const ORDER_NOTIFY_MAX = 3;

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
   * Set on up to `ORDER_NOTIFY_MAX` admins at a time: the people emailed
   * whenever an order is placed. The toggles are independent — switching
   * one on no longer switches the others off — and the cap is enforced by
   * the PATCH route, which counts the current holders and claims a slot
   * inside one transaction. See app/api/admin/admins/[id]/route.ts.
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
 * The admins who should be emailed when an order is placed — up to
 * `ORDER_NOTIFY_MAX` of them, empty if nobody is assigned.
 *
 * Deliberately NOT cached. This runs once per order, in the `after()` block
 * of the checkout route — after the transaction has committed and after the
 * response has been sent. One capped `find` at order rate is far below
 * anything the M0 ops budget cares about, and a TTL cache would only buy
 * staleness: a per-container cache is invisible to the container that
 * handled the toggle, so an owner reassigning notifications would watch
 * mail keep arriving at the old address for the length of the TTL.
 *
 * `status: "active"` is part of the filter as a second line of defence.
 * Disabling an admin already clears this flag (see the PATCH route), so a
 * disabled account should never match — but if a flag is ever left behind
 * by a direct database edit, a revoked account still does not receive
 * order mail.
 *
 * `.limit(ORDER_NOTIFY_MAX)` is the same kind of defence for the cap. The
 * PATCH route is the only thing that should ever be able to exceed it, and
 * it can't — but if drift ever puts a fourth flag in the collection, the
 * blast radius is a missing recipient rather than an unbounded internal
 * mailing list. Sorted by username so that truncation, if it ever happens,
 * is at least stable and explainable rather than dependent on scan order.
 */
export async function getOrderNotifyRecipients(): Promise<
  Array<{ email: string; username: string }>
> {
  const admins = await getAdminsCollection();
  const recipients = await admins
    .find(
      { notifyOnNewOrder: true, status: "active" },
      { projection: { email: 1, username: 1 } },
    )
    .sort({ username: 1 })
    .limit(ORDER_NOTIFY_MAX)
    .toArray();
  return recipients.map((r) => ({ email: r.email, username: r.username }));
}
