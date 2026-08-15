/**
 * Self-test for the bundle rules in lib/validation.ts.
 *
 *   npm run check:bundles
 *
 * These rules decide what a shopper is charged, and they run in two
 * places: the cart, where they are an affordance, and the checkout
 * transaction, where they are the authority. Both call the same
 * `evaluateBundles`, so this script is what stands behind both.
 *
 * Needs no database, no Redis and no network — the function under test is
 * pure by design, which is the reason it lives in lib/validation.ts rather
 * than inside the checkout route.
 *
 * The import is relative and carries its `.ts` extension so this runs
 * under `node --experimental-strip-types`, which does not resolve the
 * `@/` path alias. Same convention as scripts/check-gate.ts.
 */
import {
  BUNDLE_DISCOUNT_RATE,
  BUNDLE_SIZE,
  MIN_UNITS_PER_PRODUCT,
  bundleMinimumMessage,
  evaluateBundles,
} from "../lib/validation.ts";

let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

function eq(name: string, actual: unknown, expected: unknown) {
  check(name, Object.is(actual, expected), `got ${actual}, want ${expected}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------

section(
  `1. The quantity ladder — one product at ₱1000, minimum ${MIN_UNITS_PER_PRODUCT}, bundle at exactly ${BUNDLE_SIZE}`,
);

const ladder: Array<{
  quantity: number;
  total: number;
  discount: number;
  ok: boolean;
}> = [
  { quantity: 1, total: 1000, discount: 0, ok: false },
  { quantity: 2, total: 2000, discount: 0, ok: true },
  { quantity: 3, total: 2850, discount: 150, ok: true },
  { quantity: 4, total: 4000, discount: 0, ok: true },
  { quantity: 5, total: 5000, discount: 0, ok: true },
  { quantity: 6, total: 6000, discount: 0, ok: true },
  { quantity: 7, total: 7000, discount: 0, ok: true },
];

for (const row of ladder) {
  const result = evaluateBundles([
    { id: "A", quantity: row.quantity, price: 1000 },
  ]);
  check(
    `${row.quantity} × ₱1000 → ₱${row.total.toFixed(2)}, discount ₱${row.discount.toFixed(2)}, ${row.ok ? "orderable" : "blocked"}`,
    result.total === row.total &&
      result.discount === row.discount &&
      result.ok === row.ok,
    `got total ₱${result.total.toFixed(2)}, discount ₱${result.discount.toFixed(2)}, ok ${result.ok}`,
  );
}

// The property that makes "exactly 3" what it is, stated on its own so a
// future change to a threshold or a per-pack rule fails here loudly.
const four = evaluateBundles([{ id: "A", quantity: 4, price: 1000 }]);
check(
  "a fourth piece removes the discount entirely (not 3 discounted + 1 full)",
  four.discount === 0 && four.total === 4000,
  `got ₱${four.total.toFixed(2)}`,
);
const six = evaluateBundles([{ id: "A", quantity: 6, price: 1000 }]);
check(
  "six is not treated as two bundles",
  six.discount === 0,
  `got discount ₱${six.discount.toFixed(2)}`,
);

// ---------------------------------------------------------------------------

section("2. Grouping — colour and size never split a product");

const mixedSizes = evaluateBundles([
  { id: "A", quantity: 1, price: 1000 },
  { id: "A", quantity: 1, price: 1200 },
]);
eq("two sizes of one product count as one group", mixedSizes.groups.length, 1);
eq("their quantities add up", mixedSizes.groups[0].quantity, 2);
eq("the group spans two lines", mixedSizes.groups[0].lines, 2);
check(
  "one of each size satisfies the minimum",
  mixedSizes.ok && mixedSizes.groups[0].meetsMinimum,
);
eq("no discount at two", mixedSizes.discount, 0);

const threeAcrossVariants = evaluateBundles([
  { id: "A", quantity: 1, price: 100 },
  { id: "A", quantity: 1, price: 200 },
  { id: "A", quantity: 1, price: 300 },
]);
eq(
  "three different variants form a bundle: subtotal",
  threeAcrossVariants.subtotal,
  600,
);
eq(
  "the 5% is taken off the whole group, not one variant",
  threeAcrossVariants.discount,
  30,
);
eq("and the total follows", threeAcrossVariants.total, 570);

// ---------------------------------------------------------------------------

section("3. Groups are independent");

const twoProducts = evaluateBundles([
  { id: "A", quantity: 2, price: 1000 },
  { id: "B", quantity: 3, price: 500 },
]);
eq("subtotal spans both products", twoProducts.subtotal, 3500);
eq("only the group of three is discounted", twoProducts.discount, 75);
eq("total", twoProducts.total, 3425);
check(
  "the discounted flag lands on B alone",
  twoProducts.byProduct.get("A")?.discounted === false &&
    twoProducts.byProduct.get("B")?.discounted === true,
);

const twoBundles = evaluateBundles([
  { id: "A", quantity: 3, price: 1000 },
  { id: "B", quantity: 3, price: 500 },
]);
eq("two qualifying products earn two discounts", twoBundles.discount, 225);

// ---------------------------------------------------------------------------

section("4. The minimum blocks, and names what to fix");

const short = evaluateBundles([
  { id: "A", quantity: 1, price: 1000 },
  { id: "B", quantity: 1, price: 500 },
  { id: "C", quantity: 2, price: 250 },
]);
check("a cart with any short group is not orderable", !short.ok);
eq("both offenders are reported", short.shortGroups.length, 2);
check(
  "the satisfied group is not reported",
  !short.shortGroups.some((g) => g.id === "C"),
);
eq("shortfall says how many are missing", short.shortGroups[0].shortfall, 1);

// Two products at one unit each is two items in the cart but still an
// invalid order — the minimum is per product, not per cart.
const oneEach = evaluateBundles([
  { id: "A", quantity: 1, price: 100 },
  { id: "B", quantity: 1, price: 100 },
]);
check("two different singles do not satisfy each other", !oneEach.ok);

const message = bundleMinimumMessage(["Sporty Bag", "Trail Pack"]);
check(
  "the message names every offending product",
  message.includes("Sporty Bag") && message.includes("Trail Pack"),
  message,
);
check(
  "and tells the shopper mixing is allowed",
  /mix sizes or colours/i.test(message),
);
check(
  "a single offender reads naturally",
  /^"Sporty Bag" needs/.test(bundleMinimumMessage(["Sporty Bag"])),
  bundleMinimumMessage(["Sporty Bag"]),
);

// ---------------------------------------------------------------------------

section("5. Nudges point forward, never backward");

const nudges: Array<[number, number]> = [
  [1, 2],
  [2, 1],
  [3, 0],
  [4, 0],
  [9, 0],
];
for (const [quantity, expected] of nudges) {
  const group = evaluateBundles([{ id: "A", quantity, price: 10 }]).groups[0];
  eq(`at ${quantity}, toBundle is ${expected}`, group.toBundle, expected);
}

// ---------------------------------------------------------------------------

section("6. Money is exact");

const awkward = evaluateBundles([{ id: "A", quantity: 3, price: 33.33 }]);
eq("₱33.33 × 3 subtotal", awkward.subtotal, 99.99);
eq("half a centavo rounds up, once", awkward.discount, 5);
eq("total", awkward.total, 94.99);

// The case a naive float sum gets wrong: 0.1 + 0.1 + 0.1 is not 0.3.
const tenths = evaluateBundles([
  { id: "A", quantity: 1, price: 0.1 },
  { id: "A", quantity: 1, price: 0.1 },
  { id: "A", quantity: 1, price: 0.1 },
]);
eq("three ₱0.10 lines sum to exactly ₱0.30", tenths.subtotal, 0.3);

// The invariant every consumer relies on, over a spread of carts.
let invariantHolds = true;
for (let quantity = 1; quantity <= 12; quantity++) {
  for (const price of [0.01, 0.07, 1, 19.99, 33.33, 249.5, 1000, 8999.95]) {
    const result = evaluateBundles([{ id: "A", quantity, price }]);
    const expectedDiscount =
      quantity === BUNDLE_SIZE
        ? Math.round(Math.round(price * 100) * quantity * BUNDLE_DISCOUNT_RATE) /
          100
        : 0;
    if (
      Math.abs(result.total - (result.subtotal - result.discount)) > 1e-9 ||
      result.discount !== expectedDiscount
    ) {
      invariantHolds = false;
      console.log(
        `    ↳ ${quantity} × ₱${price}: subtotal ₱${result.subtotal}, discount ₱${result.discount}, total ₱${result.total}`,
      );
    }
  }
}
check("total === subtotal − discount across 96 carts", invariantHolds);

// ---------------------------------------------------------------------------

section("7. Junk in a persisted cart does not corrupt the maths");

const junk = evaluateBundles([
  { id: "A", quantity: 2, price: 100 },
  { id: "A", quantity: 0, price: 100 },
  { id: "A", quantity: -5, price: 100 },
  { id: "A", quantity: Number.NaN, price: 100 },
  { id: "", quantity: 3, price: 100 },
  // A line whose price never made it out of localStorage. It still counts
  // toward the quantity rules — it is a real unit the shopper wants — and
  // the server reprices everything from the variant matrix anyway.
  { id: "A", quantity: 1 },
]);
eq("only sane quantities are counted", junk.groups[0].quantity, 3);
eq("a priceless line contributes nothing to the subtotal", junk.subtotal, 200);
eq("but it does complete the bundle", junk.discount, 10);
eq("no group is created for a blank id", junk.groups.length, 1);

const empty = evaluateBundles([]);
check(
  "an empty cart is vacuously ok (emptiness is validateCartItems' job)",
  empty.ok && empty.total === 0 && empty.groups.length === 0,
);

// ---------------------------------------------------------------------------

console.log(
  failed === 0
    ? "\nAll bundle rule checks passed.\n"
    : `\n${failed} check(s) failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
