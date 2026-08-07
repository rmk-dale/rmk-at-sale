import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateOTP } from "@/lib/crypto";
import { sendOTPEmail } from "@/lib/email";
import { asEmail } from "@/lib/validation";
import {
  disallowedEmailMessage,
  isAllowedOrderEmail,
} from "@/lib/orderPolicy";
import {
  OTP_CHALLENGE_COOKIE,
  sessionCookieOptions,
} from "@/lib/customerSession";
import {
  RATE_LIMITS,
  checkRateLimit,
  checkRateLimits,
  getClientIp,
  hashIdentifier,
  rateLimitResponse,
} from "@/lib/rateLimit";
import { OTP_TTL_MS, createOtpChallenge } from "@/lib/models/otpChallenge";

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const email = asEmail(
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).email
        : undefined,
    );

    // Unlike the admin reset flow, a malformed address gets a real error
    // here: the storefront has no accounts, so there is nothing to
    // enumerate, and silently pretending to send to a typo'd address just
    // strands the shopper on the code screen.
    if (!email) {
      return NextResponse.json(
        { error: "Enter a valid email address." },
        { status: 400 },
      );
    }

    // The strongest control in this flow. Refusing to send a code to
    // anything but a company address means an outsider never gets a
    // session at all, so the rate limits below are guarding against
    // misuse by staff rather than against anonymous attack.
    //
    // Checked before the rate limiters on purpose: an outside address
    // should not be able to consume the per-IP or global send budget and
    // deny codes to real employees.
    if (!isAllowedOrderEmail(email)) {
      return NextResponse.json(
        { error: disallowedEmailMessage() },
        { status: 403 },
      );
    }

    // This endpoint sends mail from our SMTP account to an address chosen
    // entirely by the caller, with no authentication in front of it. Left
    // open it is a spam relay: a loop over arbitrary addresses gets our
    // sending domain blacklisted. Limited per IP and per target address —
    // the second matters because rotating IPs is easy, and repeatedly
    // mailing one victim is the abuse that actually hurts them.
    const ip = getClientIp(req);
    const limit = await checkRateLimits([
      { key: `otp-send:ip:${ip}`, rule: RATE_LIMITS.otpRequestPerIp },
      {
        key: `otp-send:email:${hashIdentifier(email)}`,
        rule: RATE_LIMITS.otpRequestPerEmail,
      },
    ]);

    if (!limit.ok) {
      return rateLimitResponse(
        limit,
        "Too many code requests. Please wait a few minutes before trying again.",
      );
    }

    // Site-wide ceiling on codes sent per hour.
    //
    // Checked *after* the per-IP and per-email limits, deliberately: every
    // call to checkRateLimit records an attempt, so testing the global
    // counter first would let an IP that is already over its own limit
    // keep consuming global budget and starve real customers. Checking it
    // last means it only ever counts requests that were otherwise going to
    // send mail.
    const globalLimit = await checkRateLimit(
      "otp-send:global",
      RATE_LIMITS.otpSendGlobal,
    );

    if (!globalLimit.ok) {
      // Loud on purpose. Tripping this is not normal traffic for a store
      // this size — it means a distributed attempt to burn the SMTP quota
      // is in progress, and the alternative to finding out here is finding
      // out from the mail provider.
      console.error(
        `[otp] GLOBAL send ceiling reached (${RATE_LIMITS.otpSendGlobal.limit}/hour). ` +
          `No checkout codes will be sent until the window clears. ` +
          `Latest request from ip=${ip}. Investigate before raising the limit.`,
      );
      return rateLimitResponse(
        globalLimit,
        "We can't send checkout codes right now. Please try again shortly.",
      );
    }

    const otp = generateOTP();

    // The challenge lives in the database, not in the cookie. The cookie
    // now carries only an opaque id, so the attempt counter recorded
    // against the challenge cannot be rewound by replaying an older cookie.
    const { challengeId } = await createOtpChallenge(email, otp);

    await sendOTPEmail(email, otp);

    const cookieStore = await cookies();
    cookieStore.set(
      OTP_CHALLENGE_COOKIE,
      challengeId,
      sessionCookieOptions(OTP_TTL_MS / 1000),
    );

    return NextResponse.json({
      success: true,
      message: "A checkout code is on its way.",
    });
  } catch (error: any) {
    console.error("Error generating OTP:", error);

    // Nodemailer SMTP rejection (e.g. "550 5.1.1 The email account that you tried to reach does not exist")
    if (
      error.responseCode === 550 ||
      error.responseCode === 553 ||
      (error.rejected && error.rejected.length > 0)
    ) {
      return NextResponse.json(
        { error: "This email address does not exist or cannot receive mail." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
