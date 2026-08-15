/**
 * Verification for the product write-payload parsers. No database, no network.
 *
 *   npm run check:payload
 *   node --experimental-strip-types scripts/check-product-payload.ts
 *
 * These parsers were duplicated across the create and edit routes until they
 * were lifted into lib/productPayload.ts. This file is the reason the lift is
 * safe to have done: it pins the behaviour both routes depend on, so the next
 * field added to a variant cannot quietly change how an existing one is read.
 *
 * The `stock` cases are not padding. Lifting the parser dropped `stock` from
 * the object it builds — a variant would have saved with no stock at all, and
 * nothing in the write path would have complained. TypeScript caught it that
 * time; these catch it if the field is ever made optional.
 *
 * Imports by relative path, not the `@/` alias, so it runs under bare node.
 */
import {
  parseColors,
  parseSizes,
  parseVariants,
} from "../lib/productPayload.ts";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`  [32mPASS[0m ${name}`);
  } else {
    failed++;
    console.log(`  [31mFAIL[0m ${name}`);
  }
}

function section(title: string) {
  console.log(`\n[1m${title}[0m`);
}

/** A payload that should parse cleanly, for mutating one field at a time. */
function validVariant(overrides: Record<string, unknown> = {}) {
  return {
    color: "Sporty Blue",
    size: "55cm",
    price: 1999.5,
    originalPrice: 2499,
    stock: 7,
    image: "/items/small/Airconic black 55-1.JPG",
    hoverImage: "/items/small/Airconic black 55-2.JPG",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
section("parseSizes");

check("undefined means 'nothing sent', not an error", parseSizes(undefined)?.length === 0);
check("a non-array is rejected", parseSizes("55cm") === null);
check("an object is rejected", parseSizes({ 0: "55cm" }) === null);
check("null is rejected", parseSizes(null) === null);
check(
  "labels are trimmed",
  JSON.stringify(parseSizes([" 55cm ", "67cm"])) === '["55cm","67cm"]',
);
check(
  "blank and non-string entries are dropped, not rejected",
  JSON.stringify(parseSizes(["55cm", "", "   ", 67, null])) === '["55cm"]',
);

// ---------------------------------------------------------------------------
section("parseColors");

check("undefined means 'nothing sent'", parseColors(undefined)?.length === 0);
check("a non-array is rejected", parseColors("blue") === null);
check(
  "a colour with no name is rejected",
  parseColors([{ image: "/items/small/a.jpg" }]) === null,
);
check(
  "a colour with a blank name is rejected",
  parseColors([{ name: "  ", image: "/items/small/a.jpg" }]) === null,
);
check(
  "a colour with no main photo is rejected",
  parseColors([{ name: "Blue" }]) === null,
);
check(
  "a non-object entry is rejected",
  parseColors(["Blue"]) === null,
);
check(
  "names are trimmed",
  parseColors([{ name: " Blue ", image: "/i.jpg" }])?.[0].name === "Blue",
);
check(
  "a blank hex is dropped rather than stored",
  parseColors([{ name: "Blue", image: "/i.jpg", hex: "" }])?.[0].hex === undefined,
);
check(
  "a non-string hoverImage is dropped, not rejected",
  parseColors([{ name: "Blue", image: "/i.jpg", hoverImage: 7 }])?.[0]
    .hoverImage === undefined,
);
check(
  "with no default marked, the first colour becomes it",
  (() => {
    const out = parseColors([
      { name: "Blue", image: "/a.jpg" },
      { name: "Red", image: "/b.jpg" },
    ]);
    return out?.[0].isDefault === true && out?.[1].isDefault === false;
  })(),
);
check(
  "with several marked, only the first survives",
  (() => {
    const out = parseColors([
      { name: "Blue", image: "/a.jpg" },
      { name: "Red", image: "/b.jpg", isDefault: true },
      { name: "Green", image: "/c.jpg", isDefault: true },
    ]);
    return (
      out?.filter((c) => c.isDefault).length === 1 && out?.[1].isDefault === true
    );
  })(),
);

// ---------------------------------------------------------------------------
section("parseVariants — rejections that protect an order");

check("undefined means 'nothing sent'", parseVariants(undefined)?.length === 0);
check("a non-array is rejected", parseVariants({}) === null);
check("a non-object entry is rejected", parseVariants(["x"]) === null);
check("a null entry is rejected", parseVariants([null]) === null);

check(
  "a missing price is rejected",
  parseVariants([validVariant({ price: undefined })]) === null,
);
check(
  "a string price is rejected",
  parseVariants([validVariant({ price: "1999" })]) === null,
);
check(
  "a negative price is rejected",
  parseVariants([validVariant({ price: -1 })]) === null,
);
check(
  "NaN price is rejected",
  parseVariants([validVariant({ price: NaN })]) === null,
);
check(
  "Infinity price is rejected",
  parseVariants([validVariant({ price: Infinity })]) === null,
);
check("a zero price is allowed", parseVariants([validVariant({ price: 0 })]) !== null);

check(
  "a negative originalPrice is rejected",
  parseVariants([validVariant({ originalPrice: -5 })]) === null,
);
check(
  "a string originalPrice is rejected",
  parseVariants([validVariant({ originalPrice: "2499" })]) === null,
);
check(
  "an absent originalPrice is fine (not on sale)",
  parseVariants([validVariant({ originalPrice: undefined })])?.[0]
    .originalPrice === undefined,
);
check(
  "an explicit null originalPrice normalises to undefined",
  parseVariants([validVariant({ originalPrice: null })])?.[0].originalPrice ===
    undefined,
);

check(
  "a missing stock is rejected",
  parseVariants([validVariant({ stock: undefined })]) === null,
);
check(
  "a fractional stock is rejected",
  parseVariants([validVariant({ stock: 1.5 })]) === null,
);
check(
  "a negative stock is rejected",
  parseVariants([validVariant({ stock: -1 })]) === null,
);
check(
  "a string stock is rejected",
  parseVariants([validVariant({ stock: "7" })]) === null,
);
check("a zero stock is allowed", parseVariants([validVariant({ stock: 0 })]) !== null);

section("parseVariants — the values that must survive");

check(
  "stock is carried through to the parsed variant",
  parseVariants([validVariant({ stock: 7 })])?.[0].stock === 7,
);
check(
  "a zero stock survives as 0, not undefined",
  parseVariants([validVariant({ stock: 0 })])?.[0].stock === 0,
);
check(
  "price is carried through exactly",
  parseVariants([validVariant({ price: 1999.5 })])?.[0].price === 1999.5,
);
check(
  "originalPrice is carried through",
  parseVariants([validVariant({ originalPrice: 2499 })])?.[0].originalPrice === 2499,
);
check(
  "colour and size are trimmed",
  (() => {
    const out = parseVariants([validVariant({ color: " Blue ", size: " 55cm " })]);
    return out?.[0].color === "Blue" && out?.[0].size === "55cm";
  })(),
);
check(
  "a blank colour becomes undefined, not an empty string",
  parseVariants([validVariant({ color: "   " })])?.[0].color === undefined,
);
check(
  "a sizeless row is allowed (a product with colours but no sizes)",
  parseVariants([validVariant({ size: undefined })])?.[0].size === undefined,
);

section("parseVariants — the two photos");

check(
  "image is carried through",
  parseVariants([validVariant()])?.[0].image ===
    "/items/small/Airconic black 55-1.JPG",
);
check(
  "hoverImage is carried through",
  parseVariants([validVariant()])?.[0].hoverImage ===
    "/items/small/Airconic black 55-2.JPG",
);
check(
  "an absent hoverImage is undefined, and does not reject the row",
  (() => {
    const out = parseVariants([validVariant({ hoverImage: undefined })]);
    return out !== null && out[0].hoverImage === undefined;
  })(),
);
check(
  "an absent image is undefined, and does not reject the row",
  (() => {
    const out = parseVariants([validVariant({ image: undefined })]);
    return out !== null && out[0].image === undefined;
  })(),
);
check(
  "a non-string image is dropped rather than rejecting the whole write",
  (() => {
    const out = parseVariants([validVariant({ image: 42 })]);
    return out !== null && out[0].image === undefined;
  })(),
);
check(
  "a non-string hoverImage is dropped rather than rejecting the whole write",
  (() => {
    const out = parseVariants([validVariant({ hoverImage: { $ne: null } })]);
    return out !== null && out[0].hoverImage === undefined;
  })(),
);
check(
  "an empty-string photo becomes undefined, so it never renders as a broken src",
  (() => {
    const out = parseVariants([validVariant({ image: "", hoverImage: "" })]);
    return out !== null && out[0].image === undefined && out[0].hoverImage === undefined;
  })(),
);
check(
  "the parsed variant carries no keys beyond the schema",
  (() => {
    const out = parseVariants([validVariant({ evil: "payload", $set: {} })]);
    if (!out) return false;
    const keys = Object.keys(out[0]).sort().join(",");
    return keys === "color,hoverImage,image,originalPrice,price,size,stock";
  })(),
);

check(
  "one bad row rejects the whole batch rather than saving it partially",
  parseVariants([validVariant(), validVariant({ price: -1 })]) === null,
);

// ---------------------------------------------------------------------------
console.log(`\n[1m${passed} passed, ${failed} failed[0m\n`);
if (failed > 0) process.exit(1);
