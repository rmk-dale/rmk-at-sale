/**
 * Who may order, and how often.
 *
 * This storefront is an internal employee shop, not a public one. That is
 * a much stronger security position than any rate limit can buy: if only
 * company addresses can obtain a checkout code, the anonymous-attacker
 * case disappears entirely rather than merely being throttled. The limits
 * below are the second line, sized for how employees actually buy luggage
 * rather than for an adversary.
 */

/**
 * Domains permitted to request a checkout code and place an order.
 *
 * Configurable so a second brand or a test domain can be added without a
 * code change. Comma-separated, e.g. "rgoc.com.ph,rgoc.ph".
 */
const ALLOWED_EMAIL_DOMAINS = (
  process.env.ALLOWED_EMAIL_DOMAINS ?? "rgoc.com.ph"
)
  .split(",")
  .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
  .filter(Boolean);

export function allowedEmailDomains(): string[] {
  return [...ALLOWED_EMAIL_DOMAINS];
}

/**
 * Whether `email` belongs to a permitted domain.
 *
 * Matches the domain **exactly**, and deliberately not by suffix. A
 * suffix test (`email.endsWith("rgoc.com.ph")`) would accept
 * `attacker@notrgoc.com.ph`, which an attacker can register in minutes —
 * that is the classic way this check is got wrong. Subdomains are also
 * excluded: `user@mail.rgoc.com.ph` is refused unless that exact domain is
 * listed, because who controls a subdomain's mail is a separate question
 * from who controls the parent's.
 *
 * Expects an address already normalised by `asEmail`, which guarantees
 * exactly one "@" and no whitespace.
 */
export function isAllowedOrderEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;

  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");

  // `atIndex > 0` also rejects "@rgoc.com.ph" — an empty local part. That
  // never reaches here today because asEmail rejects it first, but this
  // function should not be correct only by virtue of its caller.
  if (atIndex <= 0 || atIndex === normalized.length - 1) return false;

  // Reject anything with more than one "@" outright rather than trusting
  // the last one to be the real separator.
  if (normalized.indexOf("@") !== atIndex) return false;

  const domain = normalized.slice(atIndex + 1);
  return ALLOWED_EMAIL_DOMAINS.includes(domain);
}

/** Message shown when someone tries to order from an outside address. */
export function disallowedEmailMessage(): string {
  const domains = ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(" or ");
  return `Orders are limited to company email addresses (${domains}). Please use your work email.`;
}

// ---------------------------------------------------------------------------
// Daily order cap
// ---------------------------------------------------------------------------

/**
 * Orders one address may place in a rolling 24 hours.
 *
 * Set from how the shop is actually used — nobody buys luggage ten times
 * in a day — so it is invisible to real employees while bounding how much
 * stock a single compromised or careless account can tie up. Without a cap
 * and without payment, one account can reserve the entire sellable
 * inventory, and each of those orders looks legitimate to the team.
 */
export const DAILY_ORDER_LIMIT = Number(
  process.env.DAILY_ORDER_LIMIT ?? 10,
);

export const DAILY_ORDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Cancelled orders deliberately do NOT count toward the cap.
 *
 * The alternative punishes the common case: someone orders the wrong bag,
 * the team cancels it, and they should be able to reorder. The abuse this
 * opens up — placing orders and getting them cancelled to free quota —
 * requires an admin to act each time, so it is not a self-service bypass.
 */
export const DAILY_ORDER_COUNTED_STATUSES = ["received", "fulfilled"] as const;
