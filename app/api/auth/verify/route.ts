import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  CUSTOMER_SESSION_COOKIE,
  OTP_CHALLENGE_COOKIE,
  sessionCookieOptions,
  signCustomerSession,
  verifyCustomerSession,
} from "@/lib/customerSession";
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rateLimit";
import { consumeOtpChallenge } from "@/lib/models/otpChallenge";

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const otp =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).otp
        : undefined;

    if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
      return NextResponse.json(
        { error: "Enter the 6-digit code from your email." },
        { status: 400 },
      );
    }

    // Per-challenge attempts are capped in consumeOtpChallenge (5, then the
    // challenge is burned). This per-IP limit exists so an attacker cannot
    // sidestep that cap by cycling through fresh challenges.
    const ip = getClientIp(req);
    const limit = await checkRateLimit(
      `otp-verify:ip:${ip}`,
      RATE_LIMITS.otpVerifyPerIp,
    );
    if (!limit.ok) {
      return rateLimitResponse(
        limit,
        "Too many incorrect codes. Please wait a few minutes before trying again.",
      );
    }

    const cookieStore = await cookies();
    const challengeId = cookieStore.get(OTP_CHALLENGE_COOKIE)?.value;

    if (!challengeId) {
      return NextResponse.json(
        { error: "No code request found. Please request a new code." },
        { status: 400 },
      );
    }

    const result = await consumeOtpChallenge(challengeId, otp);

    switch (result.status) {
      case "locked":
        cookieStore.delete(OTP_CHALLENGE_COOKIE);
        return NextResponse.json(
          {
            error:
              "Too many incorrect attempts. Please request a new code.",
          },
          { status: 429 },
        );

      case "expired":
        cookieStore.delete(OTP_CHALLENGE_COOKIE);
        return NextResponse.json(
          { error: "That code has expired. Please request a new one." },
          { status: 400 },
        );

      case "invalid":
        return NextResponse.json(
          {
            error: `Incorrect code. ${result.attemptsRemaining} attempt${
              result.attemptsRemaining === 1 ? "" : "s"
            } remaining.`,
          },
          { status: 401 },
        );
    }

    // Verified. The challenge is now marked consumed, so this code cannot
    // be replayed even if the same request is sent twice.
    cookieStore.delete(OTP_CHALLENGE_COOKIE);

    const { value, maxAgeSeconds } = signCustomerSession(result.email);
    cookieStore.set(
      CUSTOMER_SESSION_COOKIE,
      value,
      sessionCookieOptions(maxAgeSeconds),
    );

    return NextResponse.json({ success: true, email: result.email });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function GET() {
  const cookieStore = await cookies();
  const session = verifyCustomerSession(
    cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value,
  );

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true, email: session.email });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(CUSTOMER_SESSION_COOKIE);
  return NextResponse.json({ success: true });
}
