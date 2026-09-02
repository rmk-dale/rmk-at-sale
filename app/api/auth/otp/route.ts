import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateOTP } from "@/lib/crypto";
import { sendOTPEmail } from "@/lib/email";
import {
  asCompanyName,
  asEmail,
  asPersonName,
  asPhoneNumber,
  canonicalEmail,
} from "@/lib/validation";
import {
  AFFILIATION_VERSION,
  EXTERNAL_ORDERS_ENABLED,
  classifyBuyer,
  disallowedEmailMessage,
  loggableDomain,
  refusedDomainMessage,
  refusedDomainReason,
} from "@/lib/orderPolicy";
import {
  OTP_CHALLENGE_COOKIE,
  sessionCookieOptions,
  type CustomerBuyerProfile,
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

    // ---------------------------------------------------------------
    // Admission. Three questions, in this order, and all of them before
    // any rate limiter is touched.
    //
    // The ordering is not stylistic. Every checkRateLimit call records an
    // attempt, so anything checked after a limiter has already spent part
    // of a budget that real buyers need. A refused address must cost us
    // nothing at all.
    // ---------------------------------------------------------------

    // 1. Is this domain refused outright? Consumer mailboxes and throwaway
    //    services. This sale is for the Rustan Group and the companies it
    //    works with, so an outside buyer is expected to have a work
    //    address.
    const refusal = refusedDomainReason(email);
    if (refusal) {
      // The domain only. It is enough to tell, after a week, whether this
      // rule is costing real orders; the full address is personal data
      // with no business in an application log.
      console.warn(
        `[otp] refused ${refusal} domain: ${loggableDomain(email)}`,
      );
      return NextResponse.json(
        { error: refusedDomainMessage(refusal) },
        { status: 403 },
      );
    }

    // 2. Which side of the company boundary is this?
    const buyerType = classifyBuyer(email);

    if (buyerType === "external" && !EXTERNAL_ORDERS_ENABLED) {
      return NextResponse.json(
        { error: disallowedEmailMessage() },
        { status: 403 },
      );
    }

    // 3. An outside buyer has to say who they are and declare their
    //    connection to the group. Collected here, at the same moment as
    //    the address, rather than at checkout — see the note on
    //    OtpChallengeDoc for why that matters for the declaration in
    //    particular.
    let profile: CustomerBuyerProfile = { buyerType };

    if (buyerType === "external") {
      // Reaching here already implies the body was an object — a
      // non-object could not have produced a valid address above — but the
      // narrowing is written out rather than relied upon, so a later edit
      // to the address parsing cannot quietly turn this into a cast of a
      // string.
      const raw = (
        typeof body === "object" && body !== null ? body : {}
      ) as Record<string, unknown>;

      const buyerName = asPersonName(raw.name);
      if (!buyerName) {
        return NextResponse.json(
          { error: "Enter the name this order should be handed to." },
          { status: 400 },
        );
      }

      const buyerCompany = asCompanyName(raw.company);
      if (!buyerCompany) {
        return NextResponse.json(
          { error: "Enter the company you're ordering for." },
          { status: 400 },
        );
      }

      const buyerPhone = asPhoneNumber(raw.phone);
      if (!buyerPhone) {
        return NextResponse.json(
          {
            error:
              "Enter a number we can reach you on — 0917 123 4567.",
          },
          { status: 400 },
        );
      }

      // Strictly true, not merely truthy. A declaration is the one field
      // here that is worth something later, when somebody has to decide
      // whether to cancel an order, so it should never be satisfiable by
      // a stray "yes" or a 1.
      if (raw.declared !== true) {
        return NextResponse.json(
          {
            error:
              "Please confirm your company's connection to the Rustan Group.",
          },
          { status: 400 },
        );
      }

      profile = {
        buyerType,
        buyerName,
        buyerCompany,
        buyerPhone,
        // The server's clock, never the client's. The whole value of this
        // record is that we wrote it.
        affiliationDeclaredAt: Date.now(),
        affiliationVersion: AFFILIATION_VERSION,
      };
    }

    // This endpoint sends mail from our SMTP account to an address chosen
    // entirely by the caller, with no authentication in front of it. Left
    // open it is a spam relay: a loop over arbitrary addresses gets our
    // sending domain blacklisted. Limited per IP and per target address —
    // the second matters because rotating IPs is easy, and repeatedly
    // mailing one victim is the abuse that actually hurts them.
    //
    // Outside buyers are limited on their own per-IP key rather than a
    // tighter shared one: the whole office is behind a single corporate
    // NAT, so a limit strict enough to mean anything against a stranger
    // would lock out the fourth colleague to check out that afternoon.
    //
    // The per-address key is the canonical form of the address, so that
    // "juan+1@" and "juan+2@" — one mailbox as far as the mail server is
    // concerned — cannot each carry their own allowance.
    const ip = getClientIp(req);
    const isExternal = buyerType === "external";
    const limit = await checkRateLimits([
      {
        key: isExternal ? `otp-send:ext:ip:${ip}` : `otp-send:ip:${ip}`,
        rule: isExternal
          ? RATE_LIMITS.otpRequestPerIpExternal
          : RATE_LIMITS.otpRequestPerIp,
      },
      {
        key: `otp-send:email:${hashIdentifier(canonicalEmail(email))}`,
        rule: RATE_LIMITS.otpRequestPerEmail,
      },
    ]);

    if (!limit.ok) {
      return rateLimitResponse(
        limit,
        "Too many code requests. Please wait a few minutes before trying again.",
      );
    }

    // Ceiling on codes sent to outside addresses, checked before the
    // site-wide one below.
    //
    // That order is what makes it reserve capacity rather than merely
    // report it: an outside request that trips this one never reaches the
    // shared counter, so it cannot spend from the budget staff depend on.
    // Reversing these two lines would leave the reservation looking
    // configured while doing nothing.
    if (isExternal) {
      const externalLimit = await checkRateLimit(
        "otp-send:global:external",
        RATE_LIMITS.otpSendGlobalExternal,
      );

      if (!externalLimit.ok) {
        console.warn(
          `[otp] external hourly send ceiling reached ` +
            `(${RATE_LIMITS.otpSendGlobalExternal.limit}/hour). Staff sends are ` +
            `unaffected. Latest request from ip=${ip}.`,
        );
        return rateLimitResponse(
          externalLimit,
          "We can't send checkout codes to outside addresses right now. Please try again shortly.",
        );
      }
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
    const { challengeId } = await createOtpChallenge(email, otp, profile);

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
  } catch (error: unknown) {
    console.error("Error generating OTP:", error);

    // Nodemailer SMTP rejection (e.g. "550 5.1.1 The email account that you
    // tried to reach does not exist"). Narrowed rather than typed `any`,
    // which the lint rule refuses and which would let a typo here read as
    // undefined and silently fall through to a 500.
    const smtp = (error ?? {}) as {
      responseCode?: unknown;
      rejected?: unknown;
    };
    if (
      smtp.responseCode === 550 ||
      smtp.responseCode === 553 ||
      (Array.isArray(smtp.rejected) && smtp.rejected.length > 0)
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
