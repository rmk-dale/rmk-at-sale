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
  groupLinesByProduct,
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
  `1. The quantity ladder — one product at ₱1000, minimum ${MIN_UNITS_PER_PRODUCT}, bundle from ${BUNDLE_SIZE} up`,
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
  { quantity: 4, total: 3800, discount: 200, ok: true },
  { quantity: 5, total: 4750, discount: 250, ok: true },
  { quantity: 6, total: 5700, discount: 300, ok: true },
  { quantity: 7, total: 6650, discount: 350, ok: true },
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

// The three properties that define the threshold as a floor. The rule was
// an equality until 2026-08-20 — a fourth piece used to forfeit the
// discount — so these are stated on their own to make a regression to that
// behaviour, or a drift into per-pack or tiered rates, fail loudly.
const four = evaluateBundles([{ id: "A", quantity: 4, price: 1000 }]);
check(
  "a fourth piece keeps the discount, applied to all four",
  four.discount === 200 && four.total === 3800,
  `got total ₱${four.total.toFixed(2)}, discount ₱${four.discount.toFixed(2)}`,
);
const six = evaluateBundles([{ id: "A", quantity: 6, price: 1000 }]);
check(
  "six is one 5%, not two bundles' worth of rate",
  six.discount === 300,
  `got discount ₱${six.discount.toFixed(2)}`,
);

// Monotonicity: no quantity a shopper can reach is worse for them than the
// one below it. This is the property "exactly 3" did not have.
let payLessNeverBySpendingMore = true;
let discountNeverShrinks = true;
for (let quantity = MIN_UNITS_PER_PRODUCT; quantity < 24; quantity++) {
  const here = evaluateBundles([{ id: "A", quantity, price: 749.95 }]);
  const next = evaluateBundles([{ id: "A", quantity: quantity + 1, price: 749.95 }]);
  if (next.total < here.total) payLessNeverBySpendingMore = false;
  if (next.discount + 1e-9 < here.discount) discountNeverShrinks = false;
}
check(
  "adding a piece never lowers what the shopper pays",
  payLessNeverBySpendingMore,
);
check("adding a piece never shrinks the discount", discountNeverShrinks);

// The discounted flag is the floor, not a window.
const flags = [2, 3, 4, 11].map(
  (quantity) =>
    evaluateBundles([{ id: "A", quantity, price: 10 }]).groups[0].discounted,
);
check(
  "discounted is false below the threshold and true at and above it",
  flags[0] === false && flags[1] && flags[2] && flags[3],
  `got ${flags.join(", ")}`,
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

// A group past the threshold beside one that has not reached it: the
// discount is the big group's alone, and the small one is untouched.
const bigAndSmall = evaluateBundles([
  { id: "A", quantity: 5, price: 1000 },
  { id: "B", quantity: 2, price: 500 },
]);
eq("subtotal spans both", bigAndSmall.subtotal, 6000);
eq("only the group of five is discounted", bigAndSmall.discount, 250);
check(
  "the group of two earns nothing from its neighbour",
  bigAndSmall.byProduct.get("B")?.discount === 0 &&
    bigAndSmall.byProduct.get("B")?.discounted === false,
);

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
      quantity >= BUNDLE_SIZE
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

section("8. Display grouping agrees with the money grouping");

// The cart renders one block per product from `groupLinesByProduct` and
// prices that block from `evaluateBundles`. If the two ever key groups
// differently, the discount is announced on the wrong block.
const interleaved = [
  { id: "A", quantity: 1, price: 100, tag: "a-blue" },
  { id: "B", quantity: 2, price: 50, tag: "b-red" },
  { id: "A", quantity: 1, price: 100, tag: "a-red" },
  { id: "A", quantity: 1, price: 100, tag: "a-green" },
];
const displayed = groupLinesByProduct(interleaved);
const priced = evaluateBundles(interleaved);

eq("one block per product", displayed.length, priced.groups.length);
check(
  "blocks and priced groups appear in the same order, keyed the same",
  displayed.every((g, i) => g.id === priced.groups[i].id),
  displayed.map((g) => g.id).join(",") +
    " vs " +
    priced.groups.map((g) => g.id).join(","),
);
check(
  "every block's unit count matches the group it is priced by",
  displayed.every((g) => g.quantity === priced.byProduct.get(g.id)?.quantity),
);
eq("interleaved lines are pulled into one block", displayed[0].lines.length, 3);
check(
  "and they keep the order the cart holds them in",
  displayed[0].lines.map((l) => l.tag).join(",") === "a-blue,a-red,a-green",
  displayed[0].lines.map((l) => l.tag).join(","),
);
check(
  "the block that earns the 5% is the one holding three lines",
  priced.byProduct.get("A")?.discounted === true &&
    priced.byProduct.get("B")?.discounted === false,
);

// Junk diverges deliberately: a line the money ignores must still render,
// or the shopper has no way to remove it.
const junkLines = [
  { id: "A", quantity: 2 },
  { id: "A", quantity: Number.NaN },
  { id: "", quantity: 3 },
];
const junkDisplayed = groupLinesByProduct(junkLines);
eq("a blank-id line still gets a block to live in", junkDisplayed.length, 2);
eq("an unusable quantity still renders as a line", junkDisplayed[0].lines.length, 2);
eq("but contributes no units", junkDisplayed[0].quantity, 2);

// ---------------------------------------------------------------------------

console.log(
  failed === 0
    ? "\nAll bundle rule checks passed.\n"
    : `\n${failed} check(s) failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
