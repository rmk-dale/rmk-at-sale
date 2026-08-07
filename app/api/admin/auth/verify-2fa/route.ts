import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { getAdminsCollection } from "@/lib/models/admin";
import {
  ADMIN_CHALLENGE_COOKIE,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_MS,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  isLockedOut,
  matchBackupCode,
  signAdminSession,
  verifyChallenge,
  verifyTotpCode,
} from "@/lib/adminAuth";
import {
  RATE_LIMITS,
  checkRateLimits,
  getClientIp,
  hashIdentifier,
  rateLimitResponse,
} from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const raw =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};

    const code = typeof raw.code === "string" ? raw.code : null;
    const backupCode =
      typeof raw.backupCode === "string" ? raw.backupCode : null;

    if (!code && !backupCode) {
      return NextResponse.json(
        { error: "A 2FA code or backup code is required." },
        { status: 400 },
      );
    }

    const cookieStore = await cookies();
    const challenge = verifyChallenge(
      cookieStore.get(ADMIN_CHALLENGE_COOKIE)?.value,
    );

    if (!challenge) {
      return NextResponse.json(
        { error: "Your login attempt expired. Please sign in again." },
        { status: 401 },
      );
    }

    const ip = getClientIp(req);
    const limit = await checkRateLimits([
      { key: `admin-2fa:ip:${ip}`, rule: RATE_LIMITS.admin2faPerIp },
      {
        key: `admin-2fa:account:${hashIdentifier(challenge.adminId)}`,
        rule: RATE_LIMITS.admin2faPerAccount,
      },
    ]);
    if (!limit.ok) {
      return rateLimitResponse(
        limit,
        "Too many verification attempts. Please wait before trying again.",
      );
    }

    const admins = await getAdminsCollection();
    const admin = await admins.findOne({
      _id: new ObjectId(challenge.adminId),
    });

    if (
      !admin ||
      admin.status !== "active" ||
      !admin.twoFactorEnabled ||
      !admin.twoFactorSecret
    ) {
      return NextResponse.json(
        { error: "Two-factor authentication is not set up for this account." },
        { status: 403 },
      );
    }

    // The lockout now covers this step too. Reaching here means the
    // password is already known, so this is the last barrier standing and
    // it needs a hard cap on guesses.
    if (isLockedOut(admin.lockedUntil)) {
      cookieStore.delete(ADMIN_CHALLENGE_COOKIE);
      return NextResponse.json(
        {
          error:
            "This account is temporarily locked due to repeated failed attempts. Try again later.",
        },
        { status: 423 },
      );
    }

    /** Counts a wrong code and locks the account once the cap is reached. */
    const recordFailure = async () => {
      const failedLoginAttempts = (admin.failedLoginAttempts ?? 0) + 1;
      const update: Record<string, unknown> = {
        failedLoginAttempts,
        updatedAt: new Date(),
      };

      const locked = failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
      if (locked) {
        update.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      }

      await admins.updateOne({ _id: admin._id }, { $set: update });

      if (locked) {
        // Drop the challenge as well, so the attacker has to get past the
        // password again after the lockout expires.
        cookieStore.delete(ADMIN_CHALLENGE_COOKIE);
        return NextResponse.json(
          {
            error:
              "Too many incorrect codes. This account is locked for 15 minutes.",
          },
          { status: 423 },
        );
      }

      return NextResponse.json(
        {
          error: `Invalid code. ${
            MAX_FAILED_LOGIN_ATTEMPTS - failedLoginAttempts
          } attempt(s) remaining before this account is locked.`,
        },
        { status: 401 },
      );
    };

    let totpStep: number | null = null;
    let verified = false;

    if (code) {
      const result = verifyTotpCode(admin.twoFactorSecret, admin.email, code);

      // A TOTP code stays valid for its whole ~90s window, so accepting the
      // same step twice would let an observed code be reused. Each step is
      // usable once per account.
      if (result && result.step > (admin.lastTotpStep ?? -1)) {
        verified = true;
        totpStep = result.step;
      }
    } else if (backupCode && admin.backupCodeHashes?.length) {
      const matchedIndex = await matchBackupCode(
        backupCode.trim().toUpperCase(),
        admin.backupCodeHashes,
      );
      if (matchedIndex !== -1) {
        // Remove the used code conditionally: the filter requires the hash
        // still to be present, so two requests racing with the same backup
        // code cannot both consume it.
        const usedHash = admin.backupCodeHashes[matchedIndex];
        const claimed = await admins.findOneAndUpdate(
          { _id: admin._id, backupCodeHashes: usedHash },
          {
            $pull: { backupCodeHashes: usedHash },
            $set: { updatedAt: new Date() },
          },
        );
        verified = claimed !== null;
      }
    }

    if (!verified) {
      return recordFailure();
    }

    // Authenticated. Only now is the failure counter cleared.
    const successUpdate: Record<string, unknown> = {
      failedLoginAttempts: 0,
      updatedAt: new Date(),
    };
    if (totpStep !== null) successUpdate.lastTotpStep = totpStep;

    await admins.updateOne(
      { _id: admin._id },
      { $set: successUpdate, $unset: { lockedUntil: "" } },
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

    return NextResponse.json({ success: true, role: admin.role });
  } catch (error) {
    console.error("Error verifying admin 2FA:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
