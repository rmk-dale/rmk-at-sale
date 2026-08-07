import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
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

    if (!role && !status) {
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

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (role) update.role = role;
    if (status) update.status = status;

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

    await admins.updateOne(
      { _id: target._id },
      revokeSessions
        ? { $set: update, $inc: { sessionEpoch: 1 } }
        : { $set: update },
    );

    const updated = await admins.findOne({ _id: target._id });

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
