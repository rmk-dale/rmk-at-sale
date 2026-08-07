import { generateHash, verifyHash } from "@/lib/crypto";

/**
 * The storefront (customer) session cookie.
 *
 * Previously each route parsed and checked this cookie inline, and none of
 * them checked the types of the fields they pulled out of the JSON. A
 * cookie of `{"email":{"$ne":null},"expires":...}` would fail the HMAC
 * check, so it was not exploitable — but `email` then flowed into the
 * order document and the receipt, and relying on a signature check several
 * lines later to save an unvalidated value is a thin margin. Parsing lives
 * in one place now, and returns either a well-typed session or null.
 */

export const CUSTOMER_SESSION_COOKIE = "session";
export const CUSTOMER_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Holds the opaque OTP challenge id. Declared here rather than in the
 * route file because Next.js type-checks `route.ts` exports and rejects
 * anything that isn't an HTTP handler.
 */
export const OTP_CHALLENGE_COOKIE = "otp_challenge";

export interface CustomerSession {
  email: string;
  expires: number;
}

export function signCustomerSession(email: string): {
  value: string;
  maxAgeSeconds: number;
} {
  const expires = Date.now() + CUSTOMER_SESSION_TTL_MS;
  const hash = generateHash(`${email}|${expires}`);
  return {
    value: JSON.stringify({ email, expires, hash }),
    maxAgeSeconds: CUSTOMER_SESSION_TTL_MS / 1000,
  };
}

export function verifyCustomerSession(
  cookieValue: string | undefined,
): CustomerSession | null {
  if (!cookieValue) return null;

  try {
    const parsed: unknown = JSON.parse(cookieValue);
    if (typeof parsed !== "object" || parsed === null) return null;

    const { email, expires, hash } = parsed as Record<string, unknown>;

    if (
      typeof email !== "string" ||
      typeof expires !== "number" ||
      typeof hash !== "string"
    ) {
      return null;
    }

    if (!Number.isFinite(expires) || Date.now() > expires) return null;
    if (!verifyHash(`${email}|${expires}`, hash)) return null;

    return { email, expires };
  } catch {
    return null;
  }
}

/** Standard cookie options for both the session and the OTP challenge. */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    // Note: tied to NODE_ENV, so preview/staging deploys that do not set
    // NODE_ENV=production will send this over plain HTTP.
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    maxAge: maxAgeSeconds,
    path: "/",
  };
}
