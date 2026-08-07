import { NextRequest, NextResponse } from "next/server";
import { getAdminsCollection } from "@/lib/models/admin";
import { generateOpaqueToken } from "@/lib/adminAuth";
import { sendAdminPasswordResetEmail } from "@/lib/email";
import { asEmail } from "@/lib/validation";
import {
  RATE_LIMITS,
  checkRateLimits,
  getClientIp,
  hashIdentifier,
  rateLimitResponse,
} from "@/lib/rateLimit";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const email = asEmail(
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).email
        : undefined,
    );

    const genericResponse = NextResponse.json({
      success: true,
      message: "If that email is registered, a reset link has been sent.",
    });

    if (!email) return genericResponse;

    // Unauthenticated and it sends mail, so it is rate limited on both
    // axes: per IP to blunt broad abuse, per address because repeatedly
    // mail-bombing one known admin (and rotating their outstanding reset
    // token each time) is the attack that actually lands.
    const limit = await checkRateLimits([
      {
        key: `admin-forgot:ip:${getClientIp(req)}`,
        rule: RATE_LIMITS.adminForgotPerIp,
      },
      {
        key: `admin-forgot:email:${hashIdentifier(email)}`,
        rule: RATE_LIMITS.adminForgotPerEmail,
      },
    ]);
    if (!limit.ok) {
      return rateLimitResponse(
        limit,
        "Too many reset requests. Please wait before trying again.",
      );
    }

    const admins = await getAdminsCollection();
    const admin = await admins.findOne({
      email,
      status: "active",
    });

    // Deliberately return the same response whether or not the account
    // exists — a different message here would let someone enumerate admins.
    if (!admin) return genericResponse;

    const { token, tokenHash } = generateOpaqueToken();
    await admins.updateOne(
      { _id: admin._id },
      {
        $set: {
          inviteTokenHash: tokenHash,
          inviteTokenExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
          updatedAt: new Date(),
        },
      },
    );

    const appUrl = process.env.APP_URL || "https://rmk-at-sale.vercel.app";
    const resetUrl = `${appUrl}/admin/reset-password?id=${admin._id.toString()}&token=${token}`;
    await sendAdminPasswordResetEmail(admin.email, resetUrl);

    return genericResponse;
  } catch (error: any) {
    console.error("Error requesting admin password reset:", error);

    // If the SMTP server rejects the email, fail silently to prevent enumeration
    if (
      error.responseCode === 550 ||
      error.responseCode === 553 ||
      (error.rejected && error.rejected.length > 0)
    ) {
      return NextResponse.json({
        success: true,
        message: "If that email is registered, a reset link has been sent.",
      });
    }

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
