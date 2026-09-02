// Relative + explicit .ts, matching lib/rateLimit.ts and lib/checkoutGate.ts,
// so this module stays importable from the `scripts/` self-tests that run
// under `node --experimental-strip-types`. The BuyerType import is type-only
// and erased at runtime, so it can keep the alias.
import { generateHash, verifyHash } from "./crypto.ts";
import type { BuyerType } from "@/lib/orderPolicy";

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

/**
 * Everything the checkout route needs to know about who is buying, beyond
 * the address itself.
 *
 * Carried in the session rather than posted with the order for one reason:
 * these values are only worth anything if they are bound to the address
 * that was actually verified. The declaration especially — a boolean a
 * client sends at checkout time proves nothing, while one recorded when the
 * code was requested, signed alongside the address it was requested for,
 * is a record of what the buyer claimed.
 */
export interface CustomerBuyerProfile {
  buyerType: BuyerType;
  buyerName?: string;
  buyerCompany?: string;
  buyerPhone?: string;
  /** Epoch ms, from the server clock. Never a value the client supplied. */
  affiliationDeclaredAt?: number;
  affiliationVersion?: string;
}

export interface CustomerSession extends CustomerBuyerProfile {
  email: string;
  expires: number;
}

/**
 * The exact string the HMAC covers.
 *
 * A JSON array rather than fields joined by a separator: a company name may
 * legitimately contain any punctuation we might have picked, and two
 * different sessions must never be able to produce one payload string.
 * JSON's own escaping makes the encoding injective, so they cannot.
 *
 * Note that this changed shape when the buyer profile was added. Sessions
 * signed by the previous version hash a different string, fail verification
 * and read as expired — so deploying this logs out anyone mid-checkout, who
 * then requests a fresh code. That is a deliberate trade against carrying a
 * second verification path that somebody has to remember to delete.
 */
function sessionPayload(session: CustomerSession): string {
  return JSON.stringify([
    session.email,
    session.expires,
    session.buyerType,
    session.buyerName ?? "",
    session.buyerCompany ?? "",
    session.buyerPhone ?? "",
    session.affiliationDeclaredAt ?? 0,
    session.affiliationVersion ?? "",
  ]);
}

export function signCustomerSession(
  email: string,
  profile: CustomerBuyerProfile,
): {
  value: string;
  maxAgeSeconds: number;
} {
  const expires = Date.now() + CUSTOMER_SESSION_TTL_MS;
  const session: CustomerSession = { ...profile, email, expires };
  const hash = generateHash(sessionPayload(session));
  return {
    value: JSON.stringify({ ...session, hash }),
    maxAgeSeconds: CUSTOMER_SESSION_TTL_MS / 1000,
  };
}

/** Narrows an optional cookie field, treating a wrong type as absent. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export function verifyCustomerSession(
  cookieValue: string | undefined,
): CustomerSession | null {
  if (!cookieValue) return null;

  try {
    const parsed: unknown = JSON.parse(cookieValue);
    if (typeof parsed !== "object" || parsed === null) return null;

    const raw = parsed as Record<string, unknown>;
    const { email, expires, hash } = raw;

    if (
      typeof email !== "string" ||
      typeof expires !== "number" ||
      typeof hash !== "string"
    ) {
      return null;
    }

    if (!Number.isFinite(expires) || Date.now() > expires) return null;

    // A session with no buyerType is one issued before outside buyers
    // existed, which makes it internal — not by assumption but by
    // construction, since an outside address could not obtain a session at
    // all until this shipped. Any other value is refused rather than
    // coerced: "external" must be a thing the server wrote, never a thing a
    // cookie claimed.
    const buyerTypeRaw = raw.buyerType;
    const buyerType: BuyerType =
      buyerTypeRaw === undefined
        ? "internal"
        : buyerTypeRaw === "internal" || buyerTypeRaw === "external"
          ? buyerTypeRaw
          : (null as unknown as BuyerType);
    if (buyerType === null) return null;

    const session: CustomerSession = {
      email,
      expires,
      buyerType,
      buyerName: optionalString(raw.buyerName),
      buyerCompany: optionalString(raw.buyerCompany),
      buyerPhone: optionalString(raw.buyerPhone),
      affiliationDeclaredAt: optionalNumber(raw.affiliationDeclaredAt),
      affiliationVersion: optionalString(raw.affiliationVersion),
    };

    // The signature covers every field above, so a tampered name, company,
    // number or declaration fails here exactly as a tampered address does.
    if (!verifyHash(sessionPayload(session), hash)) return null;

    return session;
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
