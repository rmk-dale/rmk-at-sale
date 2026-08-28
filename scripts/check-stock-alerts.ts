/**
 * Self-test for the stock-level rules in lib/stockAlerts.ts.
 *
 *   npm run check:stock
 *
 * These decide what the admin Inventory screen claims about what is left
 * on the shelf, and the case worth protecting is the one that made the
 * screen wrong before this module existed: a product whose ROOT `stock`
 * field looks healthy while one cell of its colour x size matrix is empty.
 *
 * Needs no database, no Redis and no network — the functions under test
 * are pure by design, which is why they live outside lib/models/product.ts
 * and import only a `type` from it.
 *
 * The import is relative and carries its `.ts` extension so this runs
 * under `node --experimental-strip-types`, which does not resolve the
 * `@/` path alias. Same convention as scripts/check-bundles.ts.
 */
import type { ProductVariant } from "../lib/models/product.ts";
import {
  LOW_STOCK_THRESHOLD,
  cellLabel,
  productStockAlerts,
  stockLevel,
  summariseInventory,
} from "../lib/stockAlerts.ts";

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

function variant(
  color: string,
  size: string,
  stock: number,
): ProductVariant {
  return { color, size, price: 1000, stock };
}

// ---------------------------------------------------------------------------

section(`1. The threshold ladder (low at or below ${LOW_STOCK_THRESHOLD})`);

eq("negative stock is out, not low", stockLevel(-3), "out");
eq("zero is out", stockLevel(0), "out");
eq("one is low", stockLevel(1), "low");
eq(
  `${LOW_STOCK_THRESHOLD} is the last low value`,
  stockLevel(LOW_STOCK_THRESHOLD),
  "low",
);
eq(
  `${LOW_STOCK_THRESHOLD + 1} is ok`,
  stockLevel(LOW_STOCK_THRESHOLD + 1),
  "ok",
);

// ---------------------------------------------------------------------------

section("2. A product with no variant matrix uses its root stock");

const plainOk = productStockAlerts({ stock: 40 });
eq("40 units is ok", plainOk.worst, "ok");
eq("one cell", plainOk.cellCount, 1);
eq("total is the root field", plainOk.total, 40);
eq("nothing to list", plainOk.out.length + plainOk.low.length, 0);

const plainOut = productStockAlerts({ stock: 0 });
eq("0 units is out", plainOut.worst, "out");
eq("and is listed as one cell", plainOut.out.length, 1);
eq(
  "an unnamed cell reads as All stock",
  cellLabel(plainOut.out[0]),
  "All stock",
);

// ---------------------------------------------------------------------------

section("3. THE REGRESSION: a healthy-looking total hiding an empty cell");

// This is the shape the Inventory screen used to get wrong. Root `stock`
// says 40 — and it is ALSO stale, because checkout decrements
// `variants.N.stock` and never touches the root field — while Sporty Blue
// at 55cm has nothing left to sell.
const hidden = productStockAlerts({
  stock: 40,
  variants: [
    variant("Sporty Blue", "55cm", 0),
    variant("Sporty Blue", "67cm", 12),
    variant("Deep Red", "55cm", 3),
    variant("Deep Red", "67cm", 9),
  ],
});

eq("the product is flagged out, not ok", hidden.worst, "out");
eq("the empty cell is found", hidden.out.length, 1);
eq("it is named", cellLabel(hidden.out[0]), "Sporty Blue / 55cm");
eq("the low cell is found too", hidden.low.length, 1);
eq("and named", cellLabel(hidden.low[0]), "Deep Red / 55cm");
eq("four cells counted", hidden.cellCount, 4);
eq(
  "the total is recomputed from the cells, NOT read off the stale root",
  hidden.total,
  24,
);

// ---------------------------------------------------------------------------

section("4. Worst level wins, and a full matrix stays quiet");

const lowOnly = productStockAlerts({
  stock: 999,
  variants: [variant("Blue", "S", 2), variant("Blue", "M", 30)],
});
eq("a low cell with no empty cell reads low", lowOnly.worst, "low");

const healthy = productStockAlerts({
  stock: 0, // deliberately wrong root value: it must be ignored outright
  variants: [variant("Blue", "S", 20), variant("Blue", "M", 30)],
});
eq("a stocked matrix is ok even with a zero root", healthy.worst, "ok");
eq("and totals the cells", healthy.total, 50);

// ---------------------------------------------------------------------------

section("5. The banner counts products, not cells");

const summary = summariseInventory([
  // Three empty cells, but ONE row in the table needing attention.
  {
    stock: 0,
    variants: [
      variant("Blue", "S", 0),
      variant("Blue", "M", 0),
      variant("Red", "S", 0),
    ],
  },
  { stock: 2 },
  { stock: 60 },
]);
eq("one item out", summary.outCount, 1);
eq("one item low", summary.lowCount, 1);
eq("two need attention", summary.attentionCount, 2);

const mixed = summariseInventory([
  // Out AND low in the same product: counted once, at its worst level.
  { stock: 0, variants: [variant("Blue", "S", 0), variant("Blue", "M", 2)] },
]);
eq("counted as out", mixed.outCount, 1);
eq("and not also as low", mixed.lowCount, 0);
eq("so the badge says one", mixed.attentionCount, 1);

const quiet = summariseInventory([{ stock: 60 }, { stock: 12 }]);
eq("a healthy catalogue shows no badge", quiet.attentionCount, 0);

// ---------------------------------------------------------------------------

section("6. Labels for a partial matrix");

eq(
  "size only",
  cellLabel({ size: "55cm" }),
  "55cm",
);
eq("colour only", cellLabel({ color: "Deep Red" }), "Deep Red");

// ---------------------------------------------------------------------------

console.log(
  failed === 0
    ? "\nAll stock alert checks passed.\n"
    : `\n${failed} check(s) failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
