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
  const domain = emailDomain(email);
  return domain !== null && ALLOWED_EMAIL_DOMAINS.includes(domain);
}

/**
 * The domain part of `email`, lowercased, or null if the address is not one
 * this module is prepared to reason about.
 *
 * Extracted from `isAllowedOrderEmail` without changing any of its rules, so
 * that the allowlist and the refusal lists further down parse an address in
 * exactly the same way. Two copies of this parsing drifting apart is
 * precisely how a "blocked" domain ends up reachable through a spelling the
 * other check happens to accept.
 */
function emailDomain(email: unknown): string | null {
  if (typeof email !== "string") return null;

  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");

  // `atIndex > 0` also rejects "@rgoc.com.ph" — an empty local part. That
  // never reaches here today because asEmail rejects it first, but this
  // function should not be correct only by virtue of its caller.
  if (atIndex <= 0 || atIndex === normalized.length - 1) return null;

  // Reject anything with more than one "@" outright rather than trusting
  // the last one to be the real separator.
  if (normalized.indexOf("@") !== atIndex) return null;

  return normalized.slice(atIndex + 1);
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

// ---------------------------------------------------------------------------
// Buyer classification
// ---------------------------------------------------------------------------

/**
 * Which side of the company boundary a buyer sits on.
 *
 * The domain check above used to answer "may this person order?" and both
 * call sites returned 403 on false. It now answers "what kind of buyer is
 * this?" instead — the gate became a classifier. Everything else in this
 * file follows from that one change.
 */
export type BuyerType = "internal" | "external";

export function classifyBuyer(email: unknown): BuyerType {
  return isAllowedOrderEmail(email) ? "internal" : "external";
}

/**
 * Master switch for orders from outside the company.
 *
 * Defaults to **off**, which is what makes the server-side half of this
 * feature deployable ahead of the storefront: with this unset, an external
 * address is refused exactly as it was before any of this existed.
 *
 * Checked in two places — the OTP route and the checkout route. The second
 * is what makes it a real switch rather than a door lock: sessions are
 * signed rather than stored and live 24 hours, so refusing only at the
 * entry point would leave a day's worth of already-issued external sessions
 * able to keep ordering after the switch was thrown.
 */
export const EXTERNAL_ORDERS_ENABLED =
  (process.env.EXTERNAL_ORDERS_ENABLED ?? "false").trim().toLowerCase() ===
  "true";

/**
 * The wording of the affiliation declaration a buyer agreed to.
 *
 * Stored on the order alongside the timestamp. It looks like an
 * over-engineered constant right up until someone rewrites the declaration
 * mid-sale, at which point orders placed before and after agreed to
 * materially different statements and nothing in the record says which.
 * Bump it whenever the declaration copy changes meaning.
 */
export const AFFILIATION_VERSION = "2026-09";

// ---------------------------------------------------------------------------
// Refused domains
// ---------------------------------------------------------------------------

/**
 * Consumer mailbox providers.
 *
 * This sale is for the Rustan Group and the companies it works with, so a
 * buyer from outside RGOC is expected to have a work address. Refusing the
 * big consumer providers is what keeps "external" meaning "someone at
 * another company" rather than "anyone with an inbox".
 *
 * Be honest about what this buys. The set of personal mail providers is not
 * enumerable — there is always a regional one nobody listed — so this list
 * FAILS OPEN, and a domain costs about ₱500 a year besides. It removes the
 * lazy case, nothing more. What actually holds outside buyers accountable is
 * the declaration they sign, the company they name, and the fact that a
 * human confirms an order before anything is handed over.
 */
const DEFAULT_PERSONAL_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.com.ph",
  "yahoo.co.uk",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "outlook.ph",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "fastmail.com",
  "hushmail.com",
] as const;

/**
 * Throwaway mailbox services.
 *
 * Kept separate from the list above even though both end in a refusal,
 * because they are different conversations with the buyer: "please use your
 * work address" is advice someone can act on, while "we can't send codes to
 * that provider" is a statement about the provider. Merging the lists would
 * force one message to cover both, and it would be the wrong message half
 * the time.
 */
const DEFAULT_DISPOSABLE_EMAIL_DOMAINS = [
  "mailinator.com",
  "mailinator.net",
  "guerrillamail.com",
  "sharklasers.com",
  "yopmail.com",
  "10minutemail.com",
  "temp-mail.org",
  "trashmail.com",
  "throwawaymail.com",
  "maildrop.cc",
  "getnada.com",
  "dispostable.com",
  "mohmal.com",
] as const;

/**
 * Env additions EXTEND the built-in lists rather than replacing them.
 *
 * Replacing would mean a single typo'd environment variable silently empties
 * the blocklist in production, with nothing failing loudly to say so. The
 * cost of extend-only is that removing a seeded domain takes a code change,
 * which is the right trade for something that should happen approximately
 * never.
 */
function domainSet(
  seed: readonly string[],
  raw: string | undefined,
): ReadonlySet<string> {
  const extra = (raw ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  return new Set([...seed, ...extra]);
}

const PERSONAL_EMAIL_DOMAINS = domainSet(
  DEFAULT_PERSONAL_EMAIL_DOMAINS,
  process.env.PERSONAL_EMAIL_DOMAINS,
);

const DISPOSABLE_EMAIL_DOMAINS = domainSet(
  DEFAULT_DISPOSABLE_EMAIL_DOMAINS,
  process.env.DISPOSABLE_EMAIL_DOMAINS,
);

export type RefusedDomainReason = "personal" | "disposable";

/**
 * Why this address may not order at all, or null if it may.
 *
 * Answered before `classifyBuyer`, and — importantly — before any rate
 * limiter is consumed, so a refused address cannot spend the checkout-code
 * budget that real buyers need.
 */
export function refusedDomainReason(
  email: unknown,
): RefusedDomainReason | null {
  const domain = emailDomain(email);
  if (!domain) return null;

  // An explicitly allowed domain is never refused, whatever the blocklists
  // say. This guards against configuration rather than against attackers:
  // it means a mistake in one of the env vars above can never lock the
  // company's own staff out of their own store.
  if (ALLOWED_EMAIL_DOMAINS.includes(domain)) return null;

  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return "disposable";
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return "personal";
  return null;
}

/** What the shopper is told when their address is refused outright. */
export function refusedDomainMessage(reason: RefusedDomainReason): string {
  if (reason === "disposable") {
    return "We can't send checkout codes to that email provider. Please use your work address.";
  }
  // Names a way forward rather than only saying no. This is the message most
  // likely to generate a support question, so it is worth the extra clause.
  return "This sale takes orders from company email addresses. Please use your work address — or ask your RGOC contact to order for you.";
}

/**
 * The domain of a refused address, for logging.
 *
 * The domain alone is enough to tell whether the rule is costing real
 * orders; the full address is personal data that has no business in an
 * application log.
 */
export function loggableDomain(email: unknown): string {
  return emailDomain(email) ?? "(unparseable)";
}

// ---------------------------------------------------------------------------
// Per-class order caps
// ---------------------------------------------------------------------------

/**
 * Orders an outside address may place in a rolling 24 hours.
 *
 * Much lower than the internal cap because the reasoning behind that one
 * does not transfer. `DAILY_ORDER_LIMIT` is sized so that it is invisible to
 * an employee buying luggage; this one is sized around how much stock a
 * stranger should be able to reserve, without paying, before somebody
 * notices.
 */
export const EXTERNAL_DAILY_ORDER_LIMIT = Number(
  process.env.EXTERNAL_DAILY_ORDER_LIMIT ?? 2,
);

export function dailyOrderLimitFor(buyerType: BuyerType): number {
  return buyerType === "external"
    ? EXTERNAL_DAILY_ORDER_LIMIT
    : DAILY_ORDER_LIMIT;
}
