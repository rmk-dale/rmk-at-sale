/**
 * Self-test for the signed storefront session in lib/customerSession.ts.
 *
 *   npm run check:session
 *
 * The session is the only thing standing between "a buyer typed a name,
 * a company and a declaration into a form" and "those values were written
 * onto an order". It is signed rather than stored, so the signature is the
 * whole of the integrity story: if a field can be edited in the cookie
 * without invalidating the hash, then the declaration this sale relies on
 * is worth nothing, because the buyer holds the cookie.
 *
 * Needs no database, no Redis and no network. Imports are relative with a
 * `.ts` extension so this runs under `node --experimental-strip-types`,
 * which does not resolve the `@/` path alias — and the module is imported
 * dynamically so the secret below is in place before lib/crypto.ts reads it.
 */
process.env.JWT_SECRET ||= "check-session-only-not-a-real-secret";

// Marks the file as a module. Without it TypeScript treats it as a script,
// which forbids the top-level await below and puts `external` in the global
// scope where it collides with lib.dom's own declaration. Neither shows up
// at runtime, because --experimental-strip-types only erases types — so this
// is the kind of break only `tsc --noEmit` finds.
export {};

const { signCustomerSession, verifyCustomerSession } = await import(
  "../lib/customerSession.ts"
);

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

const DECLARED_AT = Date.UTC(2026, 8, 2, 7, 12, 0);

const externalProfile = {
  buyerType: "external" as const,
  buyerName: "Juan Dela Cruz",
  buyerCompany: "Acme Retail, Inc.",
  buyerPhone: "+639171234567",
  affiliationDeclaredAt: DECLARED_AT,
  affiliationVersion: "2026-09",
};

/** Re-signs nothing: edits one field of a signed cookie, hash untouched. */
function tamper(cookie: string, patch: Record<string, unknown>): string {
  return JSON.stringify({ ...JSON.parse(cookie), ...patch });
}

// ---------------------------------------------------------------------------

section("Round trip — every field the checkout route reads must survive.");

const internal = signCustomerSession("dale@rgoc.com.ph", {
  buyerType: "internal",
});
const internalSession = verifyCustomerSession(internal.value);

eq("internal email", internalSession?.email, "dale@rgoc.com.ph");
eq("internal buyer type", internalSession?.buyerType, "internal");
eq("internal carries no name", internalSession?.buyerName, undefined);
eq("internal carries no declaration", internalSession?.affiliationDeclaredAt, undefined);

const external = signCustomerSession("jdelacruz@acmeretail.com.ph", externalProfile);
const externalSession = verifyCustomerSession(external.value);

eq("external email", externalSession?.email, "jdelacruz@acmeretail.com.ph");
eq("external buyer type", externalSession?.buyerType, "external");
eq("external name", externalSession?.buyerName, "Juan Dela Cruz");
eq("external company", externalSession?.buyerCompany, "Acme Retail, Inc.");
eq("external phone", externalSession?.buyerPhone, "+639171234567");
eq("declaration timestamp", externalSession?.affiliationDeclaredAt, DECLARED_AT);
eq("declaration version", externalSession?.affiliationVersion, "2026-09");

// ---------------------------------------------------------------------------

section(
  "Tampering — the buyer holds this cookie. Every field the order is built\n" +
    "from has to be covered by the signature, not only the address.",
);

eq("edited email is refused", verifyCustomerSession(tamper(external.value, { email: "someone@else.com" })), null);
eq("edited name is refused", verifyCustomerSession(tamper(external.value, { buyerName: "Someone Else" })), null);
eq("edited company is refused", verifyCustomerSession(tamper(external.value, { buyerCompany: "Rustan Marketing" })), null);
eq("edited phone is refused", verifyCustomerSession(tamper(external.value, { buyerPhone: "+639990000000" })), null);
eq("edited declaration time is refused", verifyCustomerSession(tamper(external.value, { affiliationDeclaredAt: 1 })), null);
eq("edited declaration version is refused", verifyCustomerSession(tamper(external.value, { affiliationVersion: "1999-01" })), null);
eq("extended expiry is refused", verifyCustomerSession(tamper(external.value, { expires: Date.now() + 86_400_000 * 30 })), null);

eq(
  "promoting internal to external is refused",
  verifyCustomerSession(tamper(internal.value, { buyerType: "external" })),
  null,
);
eq(
  "demoting external to internal is refused",
  verifyCustomerSession(tamper(external.value, { buyerType: "internal" })),
  null,
);
eq(
  "an unknown buyer type is refused outright",
  verifyCustomerSession(tamper(internal.value, { buyerType: "admin" })),
  null,
);
eq(
  "a declaration cannot be added to an internal session",
  verifyCustomerSession(
    tamper(internal.value, { affiliationDeclaredAt: DECLARED_AT, buyerCompany: "Acme" }),
  ),
  null,
);

// ---------------------------------------------------------------------------

section("Malformed and expired input is refused rather than thrown on.");

eq("missing cookie", verifyCustomerSession(undefined), null);
eq("empty cookie", verifyCustomerSession(""), null);
eq("not JSON", verifyCustomerSession("{nope"), null);
eq("JSON but not an object", verifyCustomerSession('"a string"'), null);
eq("no hash", verifyCustomerSession('{"email":"a@b.com","expires":9999999999999}'), null);
eq(
  "operator in place of the email",
  verifyCustomerSession('{"email":{"$ne":null},"expires":9999999999999,"hash":"x"}'),
  null,
);
eq(
  "an expired session is refused",
  verifyCustomerSession(tamper(internal.value, { expires: Date.now() - 1000 })),
  null,
);

// ---------------------------------------------------------------------------

section(
  "Backward compatibility — a session with no buyerType predates outside\n" +
    "buyers, so it is internal by construction rather than by assumption.",
);

const legacyShaped = JSON.parse(internal.value) as Record<string, unknown>;
delete legacyShaped.buyerType;
const legacySession = verifyCustomerSession(JSON.stringify(legacyShaped));

check("a buyerType-less session still verifies", legacySession !== null);
eq("and reads as internal", legacySession?.buyerType, "internal");

// ---------------------------------------------------------------------------

console.log(
  failed === 0 ? "\nAll session checks passed.\n" : `\n${failed} check(s) FAILED.\n`,
);
process.exit(failed === 0 ? 0 : 1);
