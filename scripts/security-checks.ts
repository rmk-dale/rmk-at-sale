/**
 * Verification for the security fixes. No database or network required —
 * these exercise the pure logic that the vulnerable paths now depend on.
 *
 *   node --experimental-strip-types scripts/security-checks.ts
 *
 * Deliberately imports the real modules by relative path (not the `@/`
 * alias) so it runs under bare node without a bundler.
 */
import {
  asEmail,
  asInteger,
  asString,
  escapeHtml,
  escapeRegex,
  validateCartItems,
} from "../lib/validation.ts";
import {
  getTransition,
  isOrderStatus,
  resolveStockEffect,
  type OrderStatus,
} from "../lib/orderTransitions.ts";
import { isAllowedOrderEmail } from "../lib/orderPolicy.ts";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`  [32mPASS[0m ${name}`);
  } else {
    failed++;
    console.log(`  [31mFAIL[0m ${name}`);
  }
}

function section(title: string) {
  console.log(`\n[1m${title}[0m`);
}

// ---------------------------------------------------------------------------
section("Finding #1 — NoSQL operator injection in checkout");
// ---------------------------------------------------------------------------

// These are the payloads that previously reached the product filter. Each
// passed the old `!cartItem.id` check because a non-empty object is truthy.
const INJECTION_PAYLOADS: unknown[] = [
  { id: { $gt: "" }, quantity: 1 },
  { id: { $ne: null }, quantity: 1 },
  { id: { $regex: ".*" }, quantity: 1 },
  { id: { $where: "true" }, quantity: 1 },
  { id: ["AT88G01001"], quantity: 1 },
  { id: 12345, quantity: 1 },
  { id: true, quantity: 1 },
  { id: null, quantity: 1 },
];

for (const payload of INJECTION_PAYLOADS) {
  const result = validateCartItems([payload]);
  check(
    `rejects ${JSON.stringify((payload as Record<string, unknown>).id)} as an item id`,
    result.ok === false,
  );
}

check(
  "accepts a legitimate item code",
  validateCartItems([{ id: "AT88G01001", quantity: 2 }]).ok === true,
);

check(
  "item id starting with $ is rejected",
  validateCartItems([{ id: "$where", quantity: 1 }]).ok === false,
);

// ---------------------------------------------------------------------------
section("Finding #5 — fractional and out-of-range quantities");
// ---------------------------------------------------------------------------

check(
  "rejects fractional quantity (near-zero order total)",
  validateCartItems([{ id: "AT88G01001", quantity: 0.0001 }]).ok === false,
);
check(
  "rejects zero quantity",
  validateCartItems([{ id: "AT88G01001", quantity: 0 }]).ok === false,
);
check(
  "rejects negative quantity (would increment stock)",
  validateCartItems([{ id: "AT88G01001", quantity: -5 }]).ok === false,
);
check(
  "rejects quantity as a numeric string",
  validateCartItems([{ id: "AT88G01001", quantity: "3" }]).ok === false,
);
check(
  "rejects quantity above the per-line cap",
  validateCartItems([{ id: "AT88G01001", quantity: 1_000_000 }]).ok === false,
);
check(
  "rejects a repeated (item, colour, size) line",
  validateCartItems([
    { id: "AT88G01001", quantity: 1, color: "Blue" },
    { id: "AT88G01001", quantity: 1, color: "Blue" },
  ]).ok === false,
);
check(
  "allows the same item in two different colours",
  validateCartItems([
    { id: "AT88G01001", quantity: 1, color: "Blue" },
    { id: "AT88G01001", quantity: 1, color: "Red" },
  ]).ok === true,
);
check("rejects an empty cart", validateCartItems([]).ok === false);
check("rejects a non-array cart", validateCartItems({ id: "x" }).ok === false);
check(
  "rejects a cart exceeding the total unit cap",
  validateCartItems(
    Array.from({ length: 20 }, (_, i) => ({
      id: `SKU${i}`,
      quantity: 99,
    })),
  ).ok === false,
);

// ---------------------------------------------------------------------------
section("Input guards");
// ---------------------------------------------------------------------------

check("asString rejects an object", asString({ $ne: null }) === null);
check("asString rejects an array", asString(["a"]) === null);
check("asString rejects empty/whitespace", asString("   ") === null);
check("asString trims", asString("  hi  ") === "hi");
check("asInteger rejects a float", asInteger(1.5, 1, 10) === null);
check("asInteger rejects NaN", asInteger(NaN, 1, 10) === null);
check("asInteger enforces the range", asInteger(11, 1, 10) === null);
check("asInteger accepts in-range", asInteger(5, 1, 10) === 5);

check("asEmail rejects an object", asEmail({ $ne: null }) === null);
check("asEmail rejects a header-injection attempt", asEmail("a@b.com\nBcc: c@d.com") === null);
check("asEmail rejects angle brackets", asEmail("<a@b.com>") === null);
check("asEmail rejects a missing TLD", asEmail("a@b") === null);
check("asEmail lowercases", asEmail("A@B.COM") === "a@b.com");
check("asEmail accepts a normal address", asEmail("dale@example.com") === "dale@example.com");

// ---------------------------------------------------------------------------
section("Email domain allowlist (internal storefront)");
// ---------------------------------------------------------------------------

check("allows a company address", isAllowedOrderEmail("dale@rgoc.com.ph"));
check(
  "allows regardless of case",
  isAllowedOrderEmail("Dale@RGOC.COM.PH"),
);
check("tolerates surrounding whitespace", isAllowedOrderEmail("  dale@rgoc.com.ph  "));

// The bypasses that matter. A suffix check — endsWith("rgoc.com.ph") —
// would wrongly accept the first two, and both domains can be registered
// by anyone in minutes.
check(
  "refuses a look-alike domain (notrgoc.com.ph)",
  !isAllowedOrderEmail("attacker@notrgoc.com.ph"),
);
check(
  "refuses a look-alike domain (xrgoc.com.ph)",
  !isAllowedOrderEmail("attacker@xrgoc.com.ph"),
);
check(
  "refuses the domain used as a prefix (rgoc.com.ph.evil.com)",
  !isAllowedOrderEmail("attacker@rgoc.com.ph.evil.com"),
);
check(
  "refuses a subdomain not explicitly listed",
  !isAllowedOrderEmail("attacker@mail.rgoc.com.ph"),
);
check(
  "refuses the domain appearing in the local part",
  !isAllowedOrderEmail("rgoc.com.ph@evil.com"),
);
check(
  "refuses an address with two @ signs",
  !isAllowedOrderEmail("attacker@evil.com@rgoc.com.ph"),
);
check("refuses an unrelated domain", !isAllowedOrderEmail("someone@gmail.com"));
check("refuses a non-string", !isAllowedOrderEmail({ $ne: null }));
check("refuses an empty string", !isAllowedOrderEmail(""));
check("refuses a bare domain with no local part", !isAllowedOrderEmail("@rgoc.com.ph"));
check("refuses a trailing @", !isAllowedOrderEmail("dale@"));

// The allowlist assumes a well-formed address, so confirm the two guards
// compose: asEmail runs first and rejects what the allowlist doesn't model.
check(
  "asEmail + allowlist compose on a header-injection attempt",
  asEmail("dale@rgoc.com.ph\nBcc: x@y.com") === null,
);

// ---------------------------------------------------------------------------
section("Finding #6 — regex injection in brand lookup");
// ---------------------------------------------------------------------------

check(
  "escapeRegex neutralises a name that would throw",
  (() => {
    try {
      new RegExp(`^${escapeRegex("C++ (Pro)")}$`);
      return true;
    } catch {
      return false;
    }
  })(),
);
check(
  "escaped pattern matches only the literal",
  new RegExp(`^${escapeRegex("A.B")}$`).test("AXB") === false,
);
check(
  "unescaped pattern would have over-matched (demonstrating the bug)",
  new RegExp("^A.B$").test("AXB") === true,
);

// ---------------------------------------------------------------------------
section("Finding #10 — HTML injection into the receipt email");
// ---------------------------------------------------------------------------

check(
  "escapeHtml neutralises a script tag",
  escapeHtml("<script>alert(1)</script>") ===
    "&lt;script&gt;alert(1)&lt;/script&gt;",
);
check(
  "escapeHtml neutralises an attribute break-out",
  escapeHtml('" onerror="x').includes("&quot;"),
);
check("escapeHtml escapes ampersands first", escapeHtml("&lt;") === "&amp;lt;");

// ---------------------------------------------------------------------------
section("Order status machine");
// ---------------------------------------------------------------------------

check("isOrderStatus accepts a known status", isOrderStatus("fulfilled"));
check("isOrderStatus rejects an unknown one", !isOrderStatus("shipped"));
check("isOrderStatus rejects an object", !isOrderStatus({ $ne: null }));

check("received -> fulfilled is allowed", getTransition("received", "fulfilled") !== null);
check("received -> cancelled is allowed", getTransition("received", "cancelled") !== null);
check("cancelled -> received is allowed", getTransition("cancelled", "received") !== null);
check(
  "cancelled -> fulfilled is refused",
  getTransition("cancelled", "fulfilled") === null,
);

// The bug this replaces: cancel restocked, reopen did not re-deduct, so a
// second cancel restocked the same units again. Replay the sequence and
// assert the net stock movement is zero.
section("Regression — cancel/reopen/cancel must not inflate stock");

function replay(sequence: Array<[OrderStatus, OrderStatus]>) {
  let stockReleased = false;
  let net = 0; // +1 per release, -1 per reserve

  for (const [from, to] of sequence) {
    const rule = getTransition(from, to);
    if (!rule) throw new Error(`illegal transition ${from} -> ${to}`);
    const resolved = resolveStockEffect(rule, stockReleased);
    if (resolved.effect === "released") net += 1;
    if (resolved.effect === "reserved") net -= 1;
    stockReleased = resolved.stockReleased;
  }

  return { net, stockReleased };
}

const cycle = replay([
  ["received", "cancelled"],
  ["cancelled", "received"],
  ["received", "cancelled"],
]);
check("cancel -> reopen -> cancel nets exactly one release", cycle.net === 1);
check("…and ends with stock released", cycle.stockReleased === true);

const longCycle = replay([
  ["received", "cancelled"],
  ["cancelled", "received"],
  ["received", "cancelled"],
  ["cancelled", "received"],
  ["received", "fulfilled"],
  ["fulfilled", "cancelled"],
]);
check("a longer cycle also nets exactly one release", longCycle.net === 1);
check("…and ends released", longCycle.stockReleased === true);

const fulfilledPath = replay([
  ["received", "fulfilled"],
  ["fulfilled", "received"],
  ["received", "fulfilled"],
]);
check(
  "received <-> fulfilled never moves stock",
  fulfilledPath.net === 0 && fulfilledPath.stockReleased === false,
);

// ---------------------------------------------------------------------------
console.log(
  `\n[1m${passed} passed, ${failed} failed[0m\n`,
);
process.exit(failed === 0 ? 0 : 1);
