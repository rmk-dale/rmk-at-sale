/**
 * Self-test for the buyer classification and domain refusal rules in
 * lib/orderPolicy.ts.
 *
 *   npm run check:buyer
 *
 * These rules decide who may obtain a checkout code at all, which — in a
 * store with no payment step, where placing an order reserves real stock —
 * is the single most consequential decision the application makes. They run
 * in two places: the OTP route, where they admit or refuse a buyer, and the
 * checkout route, where they are re-applied so a policy change reaches
 * sessions that were already issued.
 *
 * Needs no database, no Redis and no network. The import is relative and
 * carries its `.ts` extension so this runs under
 * `node --experimental-strip-types`, which does not resolve the `@/` path
 * alias. Same convention as scripts/check-bundles.ts.
 */
import {
  AFFILIATION_VERSION,
  DAILY_ORDER_LIMIT,
  EXTERNAL_DAILY_ORDER_LIMIT,
  classifyBuyer,
  dailyOrderLimitFor,
  isAllowedOrderEmail,
  loggableDomain,
  refusedDomainMessage,
  refusedDomainReason,
} from "../lib/orderPolicy.ts";
import {
  asCompanyName,
  asPersonName,
  asPhoneNumber,
  canonicalEmail,
  formatPhoneNumber,
} from "../lib/validation.ts";
import { RATE_LIMITS } from "../lib/rateLimit.ts";

let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

function eq(name: string, actual: unknown, expected: unknown) {
  check(name, Object.is(actual, expected), `got ${String(actual)}, want ${String(expected)}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------

section(
  "Classification — the company allowlist, unchanged in behaviour by the\n" +
    "extraction of emailDomain(). These are the cases the original exact-match\n" +
    "was written to get right, so they are the ones most worth re-proving.",
);

eq("plain company address is internal", classifyBuyer("dale@rgoc.com.ph"), "internal");
eq("uppercase is normalised", classifyBuyer("Dale@RGOC.com.ph"), "internal");
eq("surrounding whitespace is trimmed", classifyBuyer("  dale@rgoc.com.ph  "), "internal");

eq(
  "suffix look-alike is NOT internal",
  classifyBuyer("attacker@notrgoc.com.ph"),
  "external",
);
eq(
  "subdomain is NOT internal",
  classifyBuyer("user@mail.rgoc.com.ph"),
  "external",
);
eq("empty local part is not internal", classifyBuyer("@rgoc.com.ph"), "external");
eq("two @ signs is not internal", classifyBuyer("a@b@rgoc.com.ph"), "external");
eq("trailing @ is not internal", classifyBuyer("dale@"), "external");
eq("non-string is not internal", classifyBuyer(undefined), "external");
eq("partner company is external", classifyBuyer("jdelacruz@acmeretail.com.ph"), "external");

check(
  "isAllowedOrderEmail still agrees with classifyBuyer",
  ["dale@rgoc.com.ph", "attacker@notrgoc.com.ph", "user@mail.rgoc.com.ph", "x@y.com"].every(
    (email) => isAllowedOrderEmail(email) === (classifyBuyer(email) === "internal"),
  ),
);

// ---------------------------------------------------------------------------

section(
  "Refusal — personal and throwaway providers. A refused address never\n" +
    "reaches a rate limiter, so getting a false negative here does not merely\n" +
    "admit one buyer, it hands them the checkout-code budget as well.",
);

eq("gmail is personal", refusedDomainReason("dale@gmail.com"), "personal");
eq("yahoo.com.ph is personal", refusedDomainReason("dale@yahoo.com.ph"), "personal");
eq("outlook is personal", refusedDomainReason("dale@outlook.com"), "personal");
eq("icloud is personal", refusedDomainReason("dale@icloud.com"), "personal");
eq("proton is personal", refusedDomainReason("dale@proton.me"), "personal");
eq("mailinator is disposable", refusedDomainReason("x@mailinator.com"), "disposable");
eq("yopmail is disposable", refusedDomainReason("x@yopmail.com"), "disposable");

eq(
  "gmail dots do not evade the domain match",
  refusedDomainReason("dale.escalo@gmail.com"),
  "personal",
);
eq(
  "gmail plus-tags do not evade the domain match",
  refusedDomainReason("dale+test@gmail.com"),
  "personal",
);
eq(
  "case does not evade the domain match",
  refusedDomainReason("Dale@GMAIL.COM"),
  "personal",
);
eq(
  "a look-alike of a blocked domain is NOT refused",
  refusedDomainReason("dale@notgmail.com"),
  null,
);

eq("company address is not refused", refusedDomainReason("dale@rgoc.com.ph"), null);
eq("partner company is not refused", refusedDomainReason("j@acmeretail.com.ph"), null);
eq("unparseable address is not refused here", refusedDomainReason("nonsense"), null);

check(
  "the allowlist wins over the blocklists",
  refusedDomainReason("dale@rgoc.com.ph") === null,
  "a mis-set blocklist must never lock out company staff",
);

check(
  "refusal messages differ by reason",
  refusedDomainMessage("personal") !== refusedDomainMessage("disposable"),
);

// ---------------------------------------------------------------------------

section("Logging — the domain is enough; the address is personal data.");

eq("logs the domain only", loggableDomain("dale.escalo@gmail.com"), "gmail.com");
eq("unparseable is labelled, not echoed", loggableDomain("nonsense"), "(unparseable)");
check(
  "no local part survives into a log line",
  !loggableDomain("dale.escalo@gmail.com").includes("dale"),
);

// ---------------------------------------------------------------------------

section("Caps and constants.");

eq("internal cap", dailyOrderLimitFor("internal"), DAILY_ORDER_LIMIT);
eq("external cap", dailyOrderLimitFor("external"), EXTERNAL_DAILY_ORDER_LIMIT);
check(
  "external cap is lower than internal",
  EXTERNAL_DAILY_ORDER_LIMIT < DAILY_ORDER_LIMIT,
  `${EXTERNAL_DAILY_ORDER_LIMIT} vs ${DAILY_ORDER_LIMIT}`,
);
check(
  "affiliation version is set",
  typeof AFFILIATION_VERSION === "string" && AFFILIATION_VERSION.length > 0,
  AFFILIATION_VERSION,
);


// ---------------------------------------------------------------------------

section(
  "Names and companies — permissive on purpose. A validator written around\n" +
    "English first-and-last names rejects a large share of real Filipino ones,\n" +
    "and the shopper it rejects has no way to tell you.",
);

eq("plain name", asPersonName("Juan Dela Cruz"), "Juan Dela Cruz");
eq(
  "suffix and initials",
  asPersonName("Ma. Teresa Dela Cruz-Reyes Jr."),
  "Ma. Teresa Dela Cruz-Reyes Jr.",
);
eq("enye survives", asPersonName("Nino Munoz"), "Nino Munoz");
eq("apostrophe survives", asPersonName("Brian O'Connor"), "Brian O'Connor");
eq("whitespace is collapsed", asPersonName("  Juan   Dela  Cruz  "), "Juan Dela Cruz");
eq(
  "control characters are stripped",
  asPersonName("Juan" + String.fromCharCode(7, 0, 27) + " Dela Cruz"),
  "Juan Dela Cruz",
);

eq("an address is not a name", asPersonName("x@example.com"), null);
eq("a URL is not a name", asPersonName("https://example.com"), null);
eq("angle brackets are refused", asPersonName("<script>alert(1)</script>"), null);
eq("digits alone are not a name", asPersonName("12345"), null);
eq("punctuation alone is not a name", asPersonName("---"), null);
eq("one character is too short", asPersonName("J"), null);
eq("over 80 characters is refused", asPersonName("a".repeat(81)), null);
eq("non-string is refused", asPersonName({ $ne: null }), null);

eq("company with comma and Inc.", asCompanyName("SM Retail, Inc."), "SM Retail, Inc.");
eq("company with ampersand", asCompanyName("Ayala Land & Co."), "Ayala Land & Co.");
check("company allows more room than a name", asCompanyName("a".repeat(90)) !== null);
eq("company still caps out", asCompanyName("a".repeat(101)), null);

// ---------------------------------------------------------------------------

section("Phone numbers — stored canonical, displayed the way it is dialled here.");

eq("local mobile", asPhoneNumber("0917 123 4567"), "+639171234567");
eq("hyphenated mobile", asPhoneNumber("0917-123-4567"), "+639171234567");
eq("international mobile", asPhoneNumber("+63 917 123 4567"), "+639171234567");
eq("country code without plus", asPhoneNumber("639171234567"), "+639171234567");
eq("leading zero dropped", asPhoneNumber("9171234567"), "+639171234567");
eq("NCR landline", asPhoneNumber("(02) 8888 8888"), "+63288888888");
eq("foreign number kept as given", asPhoneNumber("+1 415 555 0100"), "+14155550100");

eq("too short is refused", asPhoneNumber("12345"), null);
eq("letters are refused", asPhoneNumber("0917 CALL ME"), null);
eq("empty is refused", asPhoneNumber(""), null);
eq("non-string is refused", asPhoneNumber(12345), null);

eq("mobile display", formatPhoneNumber("+639171234567"), "0917 123 4567");
eq("landline display", formatPhoneNumber("+63288888888"), "(02) 8888 8888");
eq("foreign display falls back", formatPhoneNumber("+14155550100"), "+14155550100");
eq("missing number displays empty", formatPhoneNumber(undefined), "");

check(
  "every accepted number round-trips through display and back",
  ["0917 123 4567", "(02) 8888 8888", "9171234567"].every((input) => {
    const stored = asPhoneNumber(input);
    return stored !== null && asPhoneNumber(formatPhoneNumber(stored)) === stored;
  }),
);

// ---------------------------------------------------------------------------

section(
  "Address canonicalisation — for limiter keys and the daily cap only. This\n" +
    "is what stops '+2' minting a fresh allowance against the cap that bounds\n" +
    "how much stock one person can reserve without paying.",
);

eq("plus tag is dropped", canonicalEmail("juan+2@acme.com"), "juan@acme.com");
eq(
  "two tagged addresses collapse to one key",
  canonicalEmail("juan+1@acme.com"),
  canonicalEmail("juan+2@acme.com"),
);
eq("gmail dots are dropped", canonicalEmail("dale.escalo@gmail.com"), "daleescalo@gmail.com");
eq(
  "googlemail is treated as gmail",
  canonicalEmail("dale.escalo@googlemail.com"),
  "daleescalo@googlemail.com",
);
eq(
  "dots are significant outside gmail",
  canonicalEmail("juan.delacruz@acme.com"),
  "juan.delacruz@acme.com",
);
eq("case is normalised", canonicalEmail("Juan@Acme.com"), "juan@acme.com");
eq("an ordinary address is unchanged", canonicalEmail("dale@rgoc.com.ph"), "dale@rgoc.com.ph");
eq("a bare tag keeps its original form", canonicalEmail("+tag@acme.com"), "+tag@acme.com");

check(
  "canonicalisation never changes the domain",
  ["a+b@x.com", "a.b@gmail.com", "A@B.com"].every(
    (email) =>
      canonicalEmail(email).split("@")[1] === email.toLowerCase().split("@")[1],
  ),
  "the domain decides refusal and classification, so it must survive intact",
);


// ---------------------------------------------------------------------------

section(
  "Rate-limit shape. These are relationships rather than values: the numbers\n" +
    "are tunable, but a sub-ceiling above the ceiling it sits under reserves\n" +
    "nothing, and fails silently while looking configured.",
);

check(
  "the external hourly ceiling sits below the site-wide one",
  RATE_LIMITS.otpSendGlobalExternal.limit < RATE_LIMITS.otpSendGlobal.limit,
  `${RATE_LIMITS.otpSendGlobalExternal.limit} of ${RATE_LIMITS.otpSendGlobal.limit}/hour, leaving ` +
    `${RATE_LIMITS.otpSendGlobal.limit - RATE_LIMITS.otpSendGlobalExternal.limit} for staff`,
);
check(
  "both hourly ceilings share a window",
  RATE_LIMITS.otpSendGlobalExternal.windowMs === RATE_LIMITS.otpSendGlobal.windowMs,
);
check(
  "the external per-IP limit is tighter than the office one",
  RATE_LIMITS.otpRequestPerIpExternal.limit < RATE_LIMITS.otpRequestPerIp.limit,
  `${RATE_LIMITS.otpRequestPerIpExternal.limit} vs ${RATE_LIMITS.otpRequestPerIp.limit} per 15 min`,
);
check(
  "an outside buyer still gets more than one attempt",
  RATE_LIMITS.otpRequestPerIpExternal.limit >= 3,
  "a mistyped address must not lock someone out of the sale",
);

// ---------------------------------------------------------------------------

console.log(
  failed === 0
    ? "\nAll buyer-policy checks passed.\n"
    : `\n${failed} check(s) FAILED.\n`,
);
process.exit(failed === 0 ? 0 : 1);
