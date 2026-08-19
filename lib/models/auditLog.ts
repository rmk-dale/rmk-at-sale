import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { AdminDoc, AdminRole } from "@/lib/models/admin";

/**
 * Attributable record of every change an admin makes.
 *
 * Orders already carried their own `statusHistory`; nothing else did. A
 * staff account could change a price, zero out stock, or delete a brand
 * and leave no trace of who or when. On a panel used by several people
 * that is the gap that actually bites — not as an attack, but on the day a
 * bag is priced at ₱1 and nobody can say how it got that way.
 *
 * Two deliberate design choices:
 *
 * 1. **Writing an audit entry never fails the operation it describes.** A
 *    logging outage should not stop the team from fulfilling orders. The
 *    cost is that the log is best-effort rather than a guarantee, so it is
 *    evidence for reconstructing what happened, not proof that nothing
 *    else did. Failures are logged loudly to stderr.
 *
 * 2. **Entries are never updated or deleted by application code.** There
 *    is no route that mutates this collection, and no TTL index — an audit
 *    trail that expires on its own is worth much less than one that
 *    doesn't. Prune manually if it ever grows enough to matter.
 */

export type AuditAction =
  | "product.create"
  | "product.update"
  | "brand.create"
  | "brand.delete"
  | "admin.invite"
  | "admin.update"
  | "admin.sessions_revoked"
  /**
   * Reassignment of the single "email me every new order" flag. Kept
   * separate from `admin.update` because it is the one admin change whose
   * effect lands on a *different* account — turning it on for one person
   * turns it off for whoever held it — and an entry that named only the
   * winner would leave no record of why the previous holder stopped
   * receiving order mail. Both usernames are in the entry's `changes`.
   */
  | "admin.order_notify_change"
  | "order.status_change";

export type AuditTargetType = "product" | "brand" | "admin" | "order";

/** A single field that moved, with both sides recorded. */
export interface AuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface AuditLogDoc {
  _id: ObjectId;
  at: Date;
  adminId: ObjectId;
  adminUsername: string;
  adminRole: AdminRole;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  /** Human-readable name, so the log stays legible if the target is gone. */
  targetLabel?: string;
  changes?: AuditChange[];
  ip?: string;
}

let indexesEnsured = false;

export async function getAuditLogCollection() {
  const db = await getDb();
  const collection = db.collection<AuditLogDoc>("auditLog");

  if (!indexesEnsured) {
    indexesEnsured = true;
    await Promise.all([
      collection.createIndex({ at: -1 }),
      collection.createIndex({ targetType: 1, targetId: 1, at: -1 }),
      collection.createIndex({ adminId: 1, at: -1 }),
    ]).catch((err) =>
      console.error("Failed to ensure audit log indexes:", err),
    );
  }

  return collection;
}

/**
 * Compares the fields being written against the document they replace and
 * returns only what actually moved.
 *
 * Recording no-op edits would bury the changes that matter, so a PATCH
 * that resubmits the same values produces an empty diff and no entry.
 * Compared by JSON shape so arrays and nested objects (sizes, colours) are
 * handled without a deep-equality dependency.
 */
export function diffFields(
  previous: Record<string, unknown>,
  update: Record<string, unknown>,
  ignore: string[] = ["updatedAt"],
): AuditChange[] {
  const changes: AuditChange[] = [];

  for (const [field, to] of Object.entries(update)) {
    if (ignore.includes(field)) continue;
    const from = previous[field];
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) continue;
    changes.push({ field, from: from ?? null, to: to ?? null });
  }

  return changes;
}

export interface RecordAuditInput {
  admin: Pick<AdminDoc, "_id" | "username" | "role">;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  targetLabel?: string;
  changes?: AuditChange[];
  ip?: string;
}

/**
 * Writes one audit entry. Never throws — see the note at the top of this
 * file on why a logging failure must not roll back real work.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    const collection = await getAuditLogCollection();
    await collection.insertOne({
      _id: new ObjectId(),
      at: new Date(),
      adminId: input.admin._id,
      adminUsername: input.admin.username,
      adminRole: input.admin.role,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
      changes: input.changes?.length ? input.changes : undefined,
      ip: input.ip,
    });
  } catch (error) {
    // Loud, because a silently missing audit trail is worse than a noisy
    // one — you would not find out until you needed it.
    console.error(
      `[audit] FAILED to record ${input.action} on ${input.targetType}:${input.targetId} ` +
        `by ${input.admin.username}:`,
      error,
    );
  }
}
