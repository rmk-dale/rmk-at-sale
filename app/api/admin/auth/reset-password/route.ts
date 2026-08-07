import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getAdminsCollection } from "@/lib/models/admin";
import { hashPassword, verifyOpaqueToken } from "@/lib/adminAuth";
import { recordAudit } from "@/lib/models/auditLog";
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rateLimit";

const MIN_PASSWORD_LENGTH = 10;

export async function POST(req: NextRequest) {
  try {
    const { id, token, password } = await req.json();

    const rl = await checkRateLimit(
      `admin-token:ip:${getClientIp(req)}`,
      RATE_LIMITS.adminTokenEndpointPerIp,
    );
    if (!rl.ok) {
      return rateLimitResponse(
        rl,
        "Too many attempts. Please wait before trying again.",
      );
    }

    if (!id || !token || !password) {
      return NextResponse.json(
        { error: "Missing reset details." },
        { status: 400 },
      );
    }

    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        {
          error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        },
        { status: 400 },
      );
    }

    if (typeof id !== "string" || !ObjectId.isValid(id)) {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired." },
        { status: 400 },
      );
    }
    if (typeof token !== "string") {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired." },
        { status: 400 },
      );
    }

    const admins = await getAdminsCollection();
    const admin = await admins.findOne({ _id: new ObjectId(id) });

    if (
      !admin ||
      admin.status !== "active" ||
      !admin.inviteTokenExpires ||
      admin.inviteTokenExpires.getTime() < Date.now() ||
      !verifyOpaqueToken(token, admin.inviteTokenHash)
    ) {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired." },
        { status: 400 },
      );
    }

    const passwordHash = await hashPassword(password);

    // Bumping sessionEpoch is the point of a password reset in a
    // compromise. Without it, resetting the password left whoever was
    // already signed in as this admin working for up to eight more hours —
    // the signed cookie stayed valid regardless of the new password.
    await admins.updateOne(
      { _id: admin._id },
      {
        $set: { passwordHash, failedLoginAttempts: 0, updatedAt: new Date() },
        $inc: { sessionEpoch: 1 },
        $unset: {
          inviteTokenHash: "",
          inviteTokenExpires: "",
          lockedUntil: "",
        },
      },
    );

    // Logged with the account as both actor and target: there is no
    // authenticated session at this point, but a password change that also
    // evicts every live session is exactly the kind of event an owner
    // should be able to see after the fact.
    await recordAudit({
      admin,
      action: "admin.sessions_revoked",
      targetType: "admin",
      targetId: admin._id.toString(),
      targetLabel: admin.username,
      changes: [{ field: "password", from: null, to: "reset via email link" }],
      ip: getClientIp(req),
    });

    return NextResponse.json({
      success: true,
      message:
        "Password updated. Any other devices signed in as you have been signed out.",
    });
  } catch (error) {
    console.error("Error resetting admin password:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
