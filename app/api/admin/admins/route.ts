import { ObjectId } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/adminGuard";
import {
  getAdminsCollection,
  toPublicAdmin,
  type AdminRole,
} from "@/lib/models/admin";
import { generateOpaqueToken } from "@/lib/adminAuth";
import { sendAdminInviteEmail } from "@/lib/email";
import { asEmail, asString } from "@/lib/validation";
import { recordAudit } from "@/lib/models/auditLog";
import { getClientIp } from "@/lib/rateLimit";

const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function GET() {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admins = await getAdminsCollection();
  const all = await admins.find().sort({ createdAt: -1 }).toArray();
  return NextResponse.json(all.map(toPublicAdmin));
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body: unknown = await req.json();
    const raw =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};

    const username = asString(raw.username, 64);
    // Format-validated, not just type-checked. This value ends up as a
    // mail recipient and is interpolated into the invite template, so the
    // same guard the checkout flow uses applies here — a "username" like
    // `x@y.com\nBcc: ...` should never reach the mail layer.
    const email = asEmail(raw.email);
    const role = raw.role;

    if (!username) {
      return NextResponse.json(
        { error: "A username is required." },
        { status: 400 },
      );
    }

    if (!email) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 },
      );
    }

    const normalizedRole: AdminRole = role === "owner" ? "owner" : "staff";
    const admins = await getAdminsCollection();

    const existing = await admins.findOne({
      $or: [{ username }, { email }],
    });
    if (existing) {
      return NextResponse.json(
        { error: "An admin with that username or email already exists." },
        { status: 409 },
      );
    }

    const { token, tokenHash } = generateOpaqueToken();
    const now = new Date();

    const result = await admins.insertOne({
      _id: new ObjectId(),
      username,
      email,
      role: normalizedRole,
      status: "invited",
      twoFactorEnabled: false,
      failedLoginAttempts: 0,
      invitedBy: owner._id,
      inviteTokenHash: tokenHash,
      inviteTokenExpires: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
      createdAt: now,
      updatedAt: now,
    });

    const appUrl = process.env.APP_URL || "https://rmk-at-sale.vercel.app";
    const inviteUrl = `${appUrl}/admin/accept-invite?id=${result.insertedId.toString()}&token=${token}`;
    await sendAdminInviteEmail(email, inviteUrl, owner.email);

    await recordAudit({
      admin: owner,
      action: "admin.invite",
      targetType: "admin",
      targetId: result.insertedId.toString(),
      targetLabel: username,
      changes: [
        { field: "email", from: null, to: email },
        { field: "role", from: null, to: normalizedRole },
      ],
      ip: getClientIp(req),
    });

    return NextResponse.json({
      success: true,
      id: result.insertedId.toString(),
    });
  } catch (error) {
    console.error("Error inviting admin:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
