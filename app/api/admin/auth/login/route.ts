import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdminsCollection } from "@/lib/models/admin";
import {
  ADMIN_CHALLENGE_COOKIE,
  CHALLENGE_TTL_MS,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  isLockedOut,
  signChallenge,
  verifyPassword,
} from "@/lib/adminAuth";
import { asString, escapeRegex } from "@/lib/validation";
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

    const identifier = asString(raw.identifier, 254);
    const password =
      typeof raw.password === "string" ? raw.password : null;

    if (!identifier || !password) {
      return NextResponse.json(
        { error: "Username/email and password are required." },
        { status: 400 },
      );
    }

    const ip = getClientIp(req);
    const limit = await checkRateLimits([
      { key: `admin-login:ip:${ip}`, rule: RATE_LIMITS.adminLoginPerIp },
      {
        key: `admin-login:account:${hashIdentifier(identifier)}`,
        rule: RATE_LIMITS.adminLoginPerAccount,
      },
    ]);
    if (!limit.ok) {
      return rateLimitResponse(
        limit,
        "Too many sign-in attempts. Please wait before trying again.",
      );
    }

    const admins = await getAdminsCollection();
    const admin = await admins.findOne({
      $or: [
        {
          username: {
            $regex: `^${escapeRegex(identifier)}$`,
            $options: "i",
          },
        },
        { email: identifier.toLowerCase() },
      ],
    });

    // Generic error for "not found" and "wrong password" alike — never reveal which.
    const invalidCredentials = () =>
      NextResponse.json(
        { error: "Invalid username/email or password." },
        { status: 401 },
      );

    if (!admin) return invalidCredentials();

    if (isLockedOut(admin.lockedUntil)) {
      return NextResponse.json(
        {
          error:
            "This account is temporarily locked due to repeated failed attempts. Try again later.",
        },
        { status: 423 },
      );
    }

    if (admin.status === "disabled") {
      return NextResponse.json(
        { error: "This admin account has been disabled." },
        { status: 403 },
      );
    }

    if (!admin.passwordHash) {
      return NextResponse.json(
        {
          error:
            "This account has not finished setup. Check your invite email.",
        },
        { status: 403 },
      );
    }

    const validPassword = await verifyPassword(password, admin.passwordHash);

    if (!validPassword) {
      const failedLoginAttempts = (admin.failedLoginAttempts ?? 0) + 1;
      const update: Record<string, unknown> = {
        failedLoginAttempts,
        updatedAt: new Date(),
      };
      if (failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        update.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      }
      await admins.updateOne({ _id: admin._id }, { $set: update });
      return invalidCredentials();
    }

    // Correct password — but the sign-in is not finished, so the failure
    // counter is deliberately NOT reset here.
    //
    // It used to be, which meant the lockout only ever protected the
    // password step: by the time an attacker holding a leaked password
    // reached 2FA, the counter had just been zeroed and nothing
    // incremented it again, leaving a 6-digit code open to unlimited
    // guessing for the life of the challenge. Carrying the counter through
    // to verify-2fa means the same 5-strikes-then-15-minutes rule covers
    // both steps of the sequence. It is reset only once a session is
    // actually issued (verify-2fa / confirm-2fa).
    if (!admin.twoFactorEnabled || !admin.twoFactorSecret) {
      return NextResponse.json(
        {
          error:
            "This account has not finished two-factor setup. Check your invite email.",
        },
        { status: 403 },
      );
    }

    const cookieStore = await cookies();
    cookieStore.set(
      ADMIN_CHALLENGE_COOKIE,
      signChallenge(admin._id.toString()),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: CHALLENGE_TTL_MS / 1000,
        path: "/",
      },
    );

    return NextResponse.json({ success: true, requiresTwoFactor: true });
  } catch (error) {
    console.error("Error during admin login:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
