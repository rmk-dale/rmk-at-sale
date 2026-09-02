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

console.log(
  failed === 0
    ? "\nAll buyer-policy checks passed.\n"
    : `\n${failed} check(s) FAILED.\n`,
);
process.exit(failed === 0 ? 0 : 1);
