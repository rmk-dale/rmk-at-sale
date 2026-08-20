import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import clientPromise from "@/lib/mongodb";
import { requireOwner } from "@/lib/adminGuard";
import {
  getAdminsCollection,
  toPublicAdmin,
  ORDER_NOTIFY_MAX,
  type AdminRole,
  type AdminStatus,
} from "@/lib/models/admin";
import { diffFields, recordAudit } from "@/lib/models/auditLog";
import { getClientIp } from "@/lib/rateLimit";

/**
 * Thrown inside the claim transaction when every notification slot is
 * already taken, purely so the abort carries a reason the catch below can
 * turn into a 400 rather than a 500.
 *
 * A plain sentinel class, not a transient Mongo error: `withTransaction`
 * retries on the latter, and retrying a full set forever is not what we
 * want. This one aborts the transaction and propagates on the first throw.
 */
class OrderNotifyLimitError extends Error {}

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

    // Order notifications go to up to ORDER_NOTIFY_MAX active admins.
    //
    // `effectiveStatus` is what the account will be once this request
    // lands, not what it is now, so a single PATCH that both disables an
    // admin and claims a slot for them is refused rather than silently
    // producing an assignment that `getOrderNotifyRecipients` will never
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

    // Losing active status releases the slot. Leaving it set would keep
    // order mail flowing to an account whose access was just revoked, and
    // — worse — would leave the store looking configured while
    // `getOrderNotifyRecipients` skipped that account.
    let notifyChange = notifyOnNewOrder;
    if (effectiveStatus !== "active" && target.notifyOnNewOrder) {
      notifyChange = false;
    }

    /** Usernames currently holding a notification slot, alphabetical. */
    const readHolders = async () => {
      const holders = await admins
        .find({ notifyOnNewOrder: true }, { projection: { username: 1 } })
        .sort({ username: 1 })
        .toArray();
      return holders.map((h) => h.username);
    };

    // Read before the write, purely so the audit entry can show the list
    // as it stood. Skipped entirely when notifications aren't part of this
    // request.
    const holdersBefore = notifyChange !== undefined ? await readHolders() : [];

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
      // Claiming a slot is a check against the *other* documents followed
      // by a write to this one, so counting and claiming have to be one
      // indivisible step. Without that, two owners switching two different
      // admins on at the same moment both read "2 holders, room for one
      // more" and both commit, leaving four addresses on every order mail.
      //
      // Two details in here are load-bearing:
      //
      // 1. The count runs INSIDE the transaction, against its snapshot,
      //    and excludes the target — so re-affirming a slot the admin
      //    already holds can never be rejected for being one over.
      //
      // 2. The `updatedAt` bump on every other admin exists purely to
      //    force a write conflict, and it is the whole reason the count
      //    can be trusted. Mongo detects conflicts only on documents a
      //    transaction actually writes, and this transaction otherwise
      //    writes just its own target — two claims on two different
      //    targets would overlap on nothing, conflict on nothing, and both
      //    commit past the cap. Touching all the others makes any two
      //    concurrent claims collide, so the loser aborts, `withTransaction`
      //    retries it against committed state, and its count sees the
      //    winner. It has to be a value that genuinely changes: an update
      //    that leaves a document byte-identical (writing `false` over
      //    `false`, say) can be skipped as a no-op and is not guaranteed
      //    to conflict at all. `updatedAt` is internal bookkeeping — it is
      //    not in `toPublicAdmin` and nothing sorts or filters on it — so
      //    moving it on a sibling row costs nothing.
      //
      // The admins collection is a handful of documents and this runs a
      // few times a year, so the cost of writing all of them is nil. None
      // of this is on the checkout path.
      const client = await clientPromise;
      const mongoSession = client.startSession();
      try {
        await mongoSession.withTransaction(async () => {
          const otherHolders = await admins.countDocuments(
            { _id: { $ne: target._id }, notifyOnNewOrder: true },
            { session: mongoSession },
          );
          if (otherHolders >= ORDER_NOTIFY_MAX) {
            throw new OrderNotifyLimitError();
          }

          await admins.updateOne({ _id: target._id }, targetWrite, {
            session: mongoSession,
          });
          await admins.updateMany(
            { _id: { $ne: target._id } },
            { $set: { updatedAt: new Date() } },
            { session: mongoSession },
          );
        });
      } catch (err) {
        if (err instanceof OrderNotifyLimitError) {
          return NextResponse.json(
            {
              error: `Order notifications are limited to ${ORDER_NOTIFY_MAX} admins. Switch one off before adding another.`,
            },
            { status: 400 },
          );
        }
        throw err;
      } finally {
        await mongoSession.endSession();
      }
    } else {
      // Clearing a slot, or not touching notifications at all, affects
      // this one document and needs no transaction. Releasing is never
      // rejected — the cap only ever constrains the way up.
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

    // Recorded as the whole recipient list before and after, not as a
    // single flag flip. With several slots, "owner switched Bob on" does
    // not answer the question people actually bring to this log — who was
    // being emailed at the time — and the list does, in one line, without
    // replaying every earlier entry.
    if (
      notifyChange !== undefined &&
      notifyChange !== (target.notifyOnNewOrder === true)
    ) {
      const holdersAfter = await readHolders();
      await recordAudit({
        admin: owner,
        action: "admin.order_notify_change",
        targetType: "admin",
        targetId: target._id.toString(),
        targetLabel: target.username,
        changes: [
          {
            field: "orderNotificationRecipients",
            from: holdersBefore.join(", ") || null,
            to: holdersAfter.join(", ") || null,
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
