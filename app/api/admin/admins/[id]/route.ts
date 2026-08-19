import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import { requireOwner } from "@/lib/adminGuard";
import {
  getAdminsCollection,
  toPublicAdmin,
  type AdminRole,
  type AdminStatus,
} from "@/lib/models/admin";
import { diffFields, recordAudit } from "@/lib/models/auditLog";
import { getClientIp } from "@/lib/rateLimit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid admin ID." }, { status: 400 });
    }

    const body: unknown = await req.json();
    const raw =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};

    // Checked against the known sets rather than cast. Previously these
    // were written to the document as-is, so a typo like "actve" would be
    // stored happily and permanently lock the account out, since
    // requireAdmin only accepts exactly "active".
    const VALID_ROLES: AdminRole[] = ["owner", "staff"];
    const VALID_STATUSES: AdminStatus[] = ["invited", "active", "disabled"];

    let role: AdminRole | undefined;
    if (raw.role !== undefined) {
      if (!VALID_ROLES.includes(raw.role as AdminRole)) {
        return NextResponse.json({ error: "Invalid role." }, { status: 400 });
      }
      role = raw.role as AdminRole;
    }

    let status: AdminStatus | undefined;
    if (raw.status !== undefined) {
      if (!VALID_STATUSES.includes(raw.status as AdminStatus)) {
        return NextResponse.json({ error: "Invalid status." }, { status: 400 });
      }
      status = raw.status as AdminStatus;
    }

    // Strictly a boolean. `raw.notifyOnNewOrder` is untrusted JSON, and it
    // decides who receives every order notification, so a truthy string or
    // a stray object must not be coerced into an assignment.
    let notifyOnNewOrder: boolean | undefined;
    if (raw.notifyOnNewOrder !== undefined) {
      if (typeof raw.notifyOnNewOrder !== "boolean") {
        return NextResponse.json(
          { error: "Invalid order-notification value." },
          { status: 400 },
        );
      }
      notifyOnNewOrder = raw.notifyOnNewOrder;
    }

    if (!role && !status && notifyOnNewOrder === undefined) {
      return NextResponse.json(
        { error: "Nothing to update." },
        { status: 400 },
      );
    }

    const admins = await getAdminsCollection();
    const target = await admins.findOne({ _id: new ObjectId(id) });
    if (!target)
      return NextResponse.json({ error: "Admin not found." }, { status: 404 });

    // Guardrail: never leave the store with zero active owners.
    const demotingOrDisablingOwner =
      target.role === "owner" &&
      ((role && role !== "owner") || status === "disabled");

    if (demotingOrDisablingOwner) {
      const otherActiveOwners = await admins.countDocuments({
        _id: { $ne: target._id },
        role: "owner",
        status: "active",
      });
      if (otherActiveOwners === 0) {
        return NextResponse.json(
          {
            error:
              "Cannot remove the last remaining owner. Promote another admin first.",
          },
          { status: 400 },
        );
      }
    }

    // Order notifications go to exactly one active admin.
    //
    // `effectiveStatus` is what the account will be once this request
    // lands, not what it is now, so a single PATCH that both disables an
    // admin and claims the flag for them is refused rather than silently
    // producing an assignment that `getOrderNotifyRecipient` will never
    // match.
    const effectiveStatus = status ?? target.status;

    if (notifyOnNewOrder === true && effectiveStatus !== "active") {
      return NextResponse.json(
        {
          error:
            "Only an active admin can receive order notifications. Have them accept their invite first.",
        },
        { status: 400 },
      );
    }

    // Losing active status releases the flag. Leaving it set would keep
    // order mail flowing to an account whose access was just revoked, and
    // — worse — would leave the store looking configured while
    // `getOrderNotifyRecipient` matched nobody.
    let notifyChange = notifyOnNewOrder;
    if (effectiveStatus !== "active" && target.notifyOnNewOrder) {
      notifyChange = false;
    }

    // Read before the write, purely so the audit entry can name the admin
    // who is losing the flag. Skipped entirely when notifications aren't
    // part of this request.
    const previousHolder =
      notifyChange !== undefined
        ? await admins.findOne(
            { notifyOnNewOrder: true },
            { projection: { username: 1 } },
          )
        : null;

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (role) update.role = role;
    if (status) update.status = status;
    if (notifyChange !== undefined) update.notifyOnNewOrder = notifyChange;

    // A role change or a disable must take effect on sessions that already
    // exist, not just on the next sign-in. Demoting an owner to staff while
    // they hold a live cookie would otherwise leave them with owner powers
    // until it expired.
    //
    // `status !== "active"` covers both "disabled" and being put back to
    // "invited"; requireAdmin already refuses non-active accounts, so this
    // is belt and braces for the role case in particular.
    const revokeSessions =
      (role && role !== target.role) || (status && status !== "active");

    const targetWrite = revokeSessions
      ? { $set: update, $inc: { sessionEpoch: 1 } }
      : { $set: update };

    if (notifyChange === true) {
      // Claiming the flag has to set it here and clear it everywhere else
      // as one indivisible step, or two owners assigning different admins
      // at the same moment leave two accounts receiving order mail.
      //
      // Two details in here are load-bearing:
      //
      // 1. The clearing write is NOT filtered on `notifyOnNewOrder: true`,
      //    which is the obvious way to write it and is wrong. Mongo
      //    detects a write conflict only on documents a transaction
      //    actually writes. With that filter, a transaction whose snapshot
      //    predates the other's commit matches nothing, writes nothing,
      //    conflicts with nothing — and both claims commit. Writing every
      //    other admin unconditionally guarantees the two overlap, so the
      //    loser aborts, retries against the committed state, and the
      //    result is exactly one holder. It also quietly repairs any drift
      //    left behind by a direct database edit.
      //
      // 2. The target is written before the others are cleared, so there
      //    is no instant at which the flag is set on nobody.
      //
      // The admins collection is a handful of documents and this runs a
      // few times a year, so the cost of writing all of them is nil. None
      // of this is on the checkout path.
      const client = await clientPromise;
      const mongoSession = client.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          await admins.updateOne({ _id: target._id }, targetWrite, {
            session: mongoSession,
          });
          await admins.updateMany(
            { _id: { $ne: target._id } },
            { $set: { notifyOnNewOrder: false } },
            { session: mongoSession },
          );
        });
      } finally {
        await mongoSession.endSession();
      }
    } else {
      // Clearing the flag, or not touching it at all, affects this one
      // document and needs no transaction.
      await admins.updateOne({ _id: target._id }, targetWrite);
    }

    const updated = await admins.findOne({ _id: target._id });

    // Only when role or status was actually part of the request. A PATCH
    // that just moved the notification flag gets the dedicated entry below
    // instead, rather than an `admin.update` with an empty diff.
    if (role || status) {
      await recordAudit({
        admin: owner,
        action: "admin.update",
        targetType: "admin",
        targetId: target._id.toString(),
        targetLabel: target.username,
        changes: diffFields(
          { role: target.role, status: target.status },
          { ...(role ? { role } : {}), ...(status ? { status } : {}) },
        ),
        ip: getClientIp(req),
      });
    }

    // Recorded as a handover rather than a flag flip, so the log answers
    // "why did X stop getting order emails" and not just "Y started".
    // `previousHolder` may be the target itself when someone toggles their
    // own row off, in which case from and to are the same name and null.
    if (
      notifyChange !== undefined &&
      notifyChange !== (target.notifyOnNewOrder === true)
    ) {
      await recordAudit({
        admin: owner,
        action: "admin.order_notify_change",
        targetType: "admin",
        targetId: target._id.toString(),
        targetLabel: target.username,
        changes: [
          {
            field: "orderNotificationRecipient",
            from: previousHolder?.username ?? null,
            to: notifyChange ? target.username : null,
          },
        ],
        ip: getClientIp(req),
      });
    }

    if (revokeSessions) {
      await recordAudit({
        admin: owner,
        action: "admin.sessions_revoked",
        targetType: "admin",
        targetId: target._id.toString(),
        targetLabel: target.username,
        ip: getClientIp(req),
      });
    }

    return NextResponse.json({
      success: true,
      admin: updated ? toPublicAdmin(updated) : null,
      sessionsRevoked: Boolean(revokeSessions),
    });
  } catch (error) {
    console.error("Error updating admin:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
