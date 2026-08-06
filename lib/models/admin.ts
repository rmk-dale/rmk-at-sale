import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

export type AdminRole = 'owner' | 'staff';
export type AdminStatus = 'invited' | 'active' | 'disabled';

export interface AdminDoc {
  _id: ObjectId;
  username: string;
  email: string;
  passwordHash?: string;        // absent until the invite is accepted
  role: AdminRole;
  status: AdminStatus;
  twoFactorSecret?: string;     // TOTP secret, only set once enrollment is confirmed
  twoFactorEnabled: boolean;
  backupCodeHashes?: string[];  // hashed one-time recovery codes
  failedLoginAttempts: number;
  lockedUntil?: Date;
  invitedBy?: ObjectId;
  inviteTokenHash?: string;     // hash of the current outstanding invite/reset token
  inviteTokenExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

let indexesEnsured = false;

export async function getAdminsCollection() {
  const db = await getDb();
  const collection = db.collection<AdminDoc>('admins');
  if (!indexesEnsured) {
    indexesEnsured = true;
    // createIndex is idempotent — safe to call on every cold start.
    await Promise.all([
      collection.createIndex({ username: 1 }, { unique: true }),
      collection.createIndex({ email: 1 }, { unique: true }),
    ]).catch((err) => console.error('Failed to ensure admin indexes:', err));
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
