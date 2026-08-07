import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { getAdminsCollection } from "@/lib/models/admin";
import {
  ADMIN_CHALLENGE_COOKIE,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_MS,
  generateBackupCodes,
  hashBackupCodes,
  signAdminSession,
  verifyChallenge,
  verifyTotpCode,
} from "@/lib/adminAuth";
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rateLimit";

/**
 * Completes 2FA enrollment right after accept-invite: verifies the first
 * code from the freshly-scanned authenticator, activates the account,
 * hands back one-time backup codes (shown once, never again), and logs
 * the admin straight in.
 */
export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();

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

    if (typeof code !== "string") {
      return NextResponse.json(
        { error: "A 6-digit code is required." },
        { status: 400 },
      );
    }

    const cookieStore = await cookies();
    const challenge = verifyChallenge(
      cookieStore.get(ADMIN_CHALLENGE_COOKIE)?.value,
    );

    if (!challenge) {
      return NextResponse.json(
        { error: "This setup session expired. Please start over." },
        { status: 401 },
      );
    }

    if (!ObjectId.isValid(challenge.adminId)) {
      return NextResponse.json(
        { error: "This setup session expired. Please start over." },
        { status: 401 },
      );
    }

    const admins = await getAdminsCollection();
    const admin = await admins.findOne({
      _id: new ObjectId(challenge.adminId),
    });

    if (!admin || !admin.twoFactorSecret || admin.twoFactorEnabled) {
      return NextResponse.json(
        { error: "This account is not awaiting 2FA setup." },
        { status: 400 },
      );
    }

    const totp = verifyTotpCode(admin.twoFactorSecret, admin.email, code);
    if (!totp) {
      return NextResponse.json(
        { error: "Invalid code. Check your authenticator app and try again." },
        { status: 401 },
      );
    }

    const backupCodes = generateBackupCodes();
    const backupCodeHashes = await hashBackupCodes(backupCodes);

    // `lastTotpStep` is seeded here so the very code used to enrol cannot
    // immediately be replayed against the login flow, and the failure
    // counter is cleared because a session is about to be issued.
    await admins.updateOne(
      { _id: admin._id },
      {
        $set: {
          twoFactorEnabled: true,
          status: "active",
          backupCodeHashes,
          lastTotpStep: totp.step,
          failedLoginAttempts: 0,
          updatedAt: new Date(),
        },
        $unset: { lockedUntil: "" },
      },
    );

    cookieStore.delete(ADMIN_CHALLENGE_COOKIE);
    cookieStore.set(
      ADMIN_SESSION_COOKIE,
      signAdminSession(
        admin._id.toString(),
        admin.role,
        admin.sessionEpoch ?? 0,
      ),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: ADMIN_SESSION_TTL_MS / 1000,
        path: "/",
      },
    );

    return NextResponse.json({ success: true, role: admin.role, backupCodes });
  } catch (error) {
    console.error("Error confirming admin 2FA setup:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
