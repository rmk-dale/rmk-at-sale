/**
 * Verification for the size/photo suggestion logic. No database, no network,
 * no browser — this is the pure logic the admin picker's ranking depends on.
 *
 *   npm run check:photos
 *   node --experimental-strip-types scripts/check-photo-buckets.ts
 *
 * Deliberately imports the real module by relative path (not the `@/` alias)
 * so it runs under bare node without a bundler.
 *
 * The cases below are drawn from actual filenames in public/items/, because
 * the whole risk in this feature is a plausible-looking rule that misfires on
 * this specific catalog. The screenshot section is the one that matters: a
 * naive substring search for a size number finds it inside a timestamp and
 * recommends screenshots for every variant.
 */
import {
  BUCKET_LABELS,
  BUCKET_ORDER,
  bucketForSizeIndex,
  bucketFromDir,
  bucketCounts,
  filenameMatchesSize,
  filenameNumbers,
  groupPhotos,
  matchesQuery,
  partitionForSize,
  scorePhotoForSize,
  sizeNumber,
  suggestFor,
  type PhotoBucket,
  type PhotoLike,
} from "../lib/photoBuckets.ts";

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

function photo(filename: string, bucket: PhotoBucket): PhotoLike {
  return { filename, path: `/items/${bucket}/${filename}`, bucket };
}

// ---------------------------------------------------------------------------
section("bucketFromDir");

check('"small" -> small', bucketFromDir("small") === "small");
check('"medium" -> medium', bucketFromDir("medium") === "medium");
check('"large" -> large', bucketFromDir("large") === "large");
check('"Large" (case) -> large', bucketFromDir("Large") === "large");
check('"" (top level) -> other', bucketFromDir("") === "other");
check('unknown folder -> other, not a crash', bucketFromDir("mid") === "other");
check(
  "nested folder classified by its first segment",
  bucketFromDir("small/archive") === "small",
);

// ---------------------------------------------------------------------------
section("sizeNumber");

check('"55cm" -> 55', sizeNumber("55cm") === 55);
check('"67 cm" -> 67', sizeNumber("67 cm") === 67);
check('"SP79" -> 79', sizeNumber("SP79") === 79);
check('"78" -> 78', sizeNumber("78") === 78);
check('"One size" -> undefined', sizeNumber("One size") === undefined);
check('"M" -> undefined', sizeNumber("M") === undefined);
check("undefined -> undefined", sizeNumber(undefined) === undefined);
check('"" -> undefined', sizeNumber("") === undefined);
check('"55-67cm" takes the leading value', sizeNumber("55-67cm") === 55);
check(
  "a label that is only a long code has no size",
  sizeNumber("145745-1011") === undefined,
);

// ---------------------------------------------------------------------------
section("filenameNumbers — the screenshot trap");

// "185501" contains the substring "55". A substring search would match a 55cm
// variant against every screenshot taken between 18:55 and 18:56, and against
// plenty of others besides. Whole-run comparison plus the 3-digit cap is what
// prevents it.
check(
  '"Screenshot 2026-08-15 185501.png" yields no size numbers',
  filenameNumbers("Screenshot 2026-08-15 185501.png").length === 0,
);
check(
  "that screenshot does NOT match size 55",
  filenameMatchesSize("Screenshot 2026-08-15 185501.png", 55) === false,
);
check(
  "the date in a screenshot name cannot match size 15",
  filenameMatchesSize("Screenshot 2026-08-15 181616.png", 15) === false,
);
check(
  "the date in a screenshot name cannot match size 20",
  filenameMatchesSize("Screenshot 2026-08-07 071829.png", 20) === false,
);
check(
  "the date in a screenshot name cannot match size 8",
  filenameMatchesSize("Screenshot 2026-08-07 071829.png", 8) === false,
);
check(
  "underscore-separated dates are stripped too",
  filenameMatchesSize("Screenshot 2026_08_15 185501.png", 15) === false,
);

// ---------------------------------------------------------------------------
section("filenameMatchesSize — real catalog names");

check(
  '"Airconic black 55-1.JPG" matches 55',
  filenameMatchesSize("Airconic black 55-1.JPG", 55),
);
check(
  '"Airconic black 67-1.JPG" matches 67, not 55',
  filenameMatchesSize("Airconic black 67-1.JPG", 67) &&
    !filenameMatchesSize("Airconic black 67-1.JPG", 55),
);
check(
  '"Airconic 77 Purist Blue - 4.JPG" matches 77',
  filenameMatchesSize("Airconic 77 Purist Blue - 4.JPG", 77),
);
check(
  '"Maxivo SP68 Red-2.jpeg" matches 68',
  filenameMatchesSize("Maxivo SP68 Red-2.jpeg", 68),
);
check(
  '"MAXIVO 55 Petrol Blue 6.jpeg" matches 55',
  filenameMatchesSize("MAXIVO 55 Petrol Blue 6.jpeg", 55),
);
check(
  '"twist waves sp55 red -2.jpeg" matches 55',
  filenameMatchesSize("twist waves sp55 red -2.jpeg", 55),
);
check(
  '"Curio SP68 Solar Yellow -2.jpeg" matches 68',
  filenameMatchesSize("Curio SP68 Solar Yellow -2.jpeg", 68),
);
// Known and accepted: the "-1" shot index is a 1-digit run, so a product
// with a size literally labelled "1" would see every photo suggested. No real
// size label in this catalog is a bare single digit, and tightening the rule
// to two digits would lose nothing today but would silently stop working the
// day someone adds a "9cm" pouch. Documented rather than defended against.
check(
  "a trailing shot index does read as a number (accepted false positive)",
  filenameMatchesSize("Airconic black 55-1.JPG", 1) === true,
);

section("filenameMatchesSize — style codes must not match");

// These encode the size, but as a product code rather than the size label:
// 145745 is the 55cm SKU, 145746 the 67cm. Matching them would need a
// per-brand table, and getting it wrong is worse than not guessing.
check(
  '"145745-1011--8.jpg" does not match 55',
  !filenameMatchesSize("145745-1011--8.jpg", 55),
);
check(
  '"151512-1491_Front34_1.jpg" does not match 55',
  !filenameMatchesSize("151512-1491_Front34_1.jpg", 55),
);
check(
  '"128186_8162_AIRCONIC_SPINNER_5520_TSA_FRONT.JPG.jpg" does not match 55',
  !filenameMatchesSize(
    "128186_8162_AIRCONIC_SPINNER_5520_TSA_FRONT.JPG.jpg",
    55,
  ),
);
check(
  '"PROD_COL_148232_1879_FRONT.jpg" does not match 55',
  !filenameMatchesSize("PROD_COL_148232_1879_FRONT.jpg", 55),
);
check(
  "a 4-digit run is never a size",
  filenameNumbers("foo_5520_bar.jpg").length === 0,
);
check(
  '"S (1).png" does not match 55',
  !filenameMatchesSize("S (1).png", 55),
);
check("an undefined size never matches", !filenameMatchesSize("55.jpg", undefined));

// ---------------------------------------------------------------------------
section("bucketForSizeIndex");

check("one size gets no guess at all", bucketForSizeIndex(0, 1) === undefined);
check("two sizes read as the extremes (first)", bucketForSizeIndex(0, 2) === "small");
check("two sizes read as the extremes (last)", bucketForSizeIndex(1, 2) === "large");
check("three sizes map straight through (0)", bucketForSizeIndex(0, 3) === "small");
check("three sizes map straight through (1)", bucketForSizeIndex(1, 3) === "medium");
check("three sizes map straight through (2)", bucketForSizeIndex(2, 3) === "large");
check("five sizes: ends are small/large", bucketForSizeIndex(0, 5) === "small");
check("five sizes: last is large", bucketForSizeIndex(4, 5) === "large");
check("five sizes: middles are all medium", bucketForSizeIndex(2, 5) === "medium");
check("five sizes: index 1 is medium", bucketForSizeIndex(1, 5) === "medium");
check("five sizes: index 3 is medium", bucketForSizeIndex(3, 5) === "medium");

// ---------------------------------------------------------------------------
section("suggestFor");

const threeSizes = ["55cm", "67cm", "77cm"];

check(
  "55cm of three sizes suggests small",
  suggestFor("55cm", threeSizes).bucket === "small",
);
check(
  "67cm of three sizes suggests medium",
  suggestFor("67cm", threeSizes).bucket === "medium",
);
check(
  "77cm of three sizes suggests large",
  suggestFor("77cm", threeSizes).bucket === "large",
);
check(
  "the size number is carried through",
  suggestFor("67cm", threeSizes).number === 67,
);
check("no size label means no suggestion", suggestFor(undefined, threeSizes).label === undefined);

// Order on the product is whatever the admin typed; ranking must not depend on it.
const shuffled = ["77cm", "55cm", "67cm"];
check(
  "sizes entered out of order still rank by value",
  suggestFor("55cm", shuffled).bucket === "small" &&
    suggestFor("77cm", shuffled).bucket === "large",
);

// The bug this guards: sorting the caller's array in place would reorder the
// size row on the storefront as a side effect of opening a picker.
const mutationCanary = ["77cm", "55cm", "67cm"];
suggestFor("55cm", mutationCanary);
check(
  "suggestFor does not mutate the sizes array it was given",
  mutationCanary.join(",") === "77cm,55cm,67cm",
);

check(
  "a size not present in the list gets no bucket",
  suggestFor("90cm", threeSizes).bucket === undefined,
);
check(
  "a non-numeric size among numeric ones sorts last, not first",
  suggestFor("One size", ["55cm", "One size", "77cm"]).bucket === "large",
);
check(
  "a non-numeric size still keeps its label and undefined number",
  suggestFor("One size", ["One size"]).number === undefined,
);

// ---------------------------------------------------------------------------
section("scorePhotoForSize");

const suggestion55 = suggestFor("55cm", threeSizes);

check(
  "name + folder agreement scores highest",
  scorePhotoForSize(photo("Airconic black 55-1.JPG", "small"), suggestion55) === 3,
);
check(
  "name alone outranks folder alone",
  scorePhotoForSize(photo("Airconic black 55-1.JPG", "large"), suggestion55) >
    scorePhotoForSize(photo("Screenshot 2026-08-15 185501.png", "small"), suggestion55),
);
check(
  "folder alone scores 1",
  scorePhotoForSize(photo("Screenshot 2026-08-15 185501.png", "small"), suggestion55) === 1,
);
check(
  "no signal scores 0",
  scorePhotoForSize(photo("Screenshot 2026-08-15 185501.png", "large"), suggestion55) === 0,
);
check(
  "with no suggestion at all, nothing scores",
  scorePhotoForSize(photo("Airconic black 55-1.JPG", "small"), {}) === 0,
);

// ---------------------------------------------------------------------------
section("partitionForSize");

const library: PhotoLike[] = [
  photo("Airconic black 55-1.JPG", "small"),
  photo("Airconic black 55-2.JPG", "small"),
  photo("Airconic black 67-1.JPG", "medium"),
  photo("Airconic black 77-1.JPG", "large"),
  photo("Screenshot 2026-08-15 185501.png", "small"),
  photo("Screenshot 2026-08-15 192321.png", "large"),
  photo("145745-1011--8.jpg", "small"),
  photo("l.png", "large"),
];

const part55 = partitionForSize(library, suggestion55);

check(
  "suggested holds exactly the two 55-named photos",
  part55.suggested.length === 2 &&
    part55.suggested.every((p) => p.filename.includes("55-")),
);
check(
  "nothing is dropped — the two groups re-form the whole library",
  part55.suggested.length + part55.rest.length === library.length,
);
check(
  "a folder match alone does not reach the suggested group",
  !part55.suggested.some((p) => p.filename.startsWith("Screenshot")),
);
check(
  "the rest is ordered with the size's own folder first",
  part55.rest[0].bucket === "small",
);

const partNoSuggestion = partitionForSize(library, {});
check(
  "with no suggestion the suggested group is empty and nothing is lost",
  partNoSuggestion.suggested.length === 0 &&
    partNoSuggestion.rest.length === library.length,
);

// ---------------------------------------------------------------------------
section("groupPhotos");

const grouped = groupPhotos(library, { suggestion: suggestion55 });

check("a suggested group leads when there are hits", grouped[0].key === "suggested");
check(
  "the suggested group is titled with the size the admin is filling",
  grouped[0].title === "Suggested for 55cm",
);
check(
  "every photo still appears exactly once across all groups",
  grouped.reduce((n, g) => n + g.photos.length, 0) === library.length,
);
check(
  "the size's own folder is the first folder group",
  grouped[1].key === "small",
);
check(
  "remaining folder groups are labelled as leftovers",
  grouped[1].title === "Rest of Small",
);

const groupedNoHits = groupPhotos(
  [photo("l.png", "large"), photo("m.png", "medium")],
  { suggestion: suggestion55 },
);
check(
  "no filename hits means no suggested group at all",
  !groupedNoHits.some((g) => g.key === "suggested"),
);
check(
  "and then folder groups get their plain names",
  groupedNoHits[0].title ===
    BUCKET_LABELS[groupedNoHits[0].key as PhotoBucket],
);

const chipped = groupPhotos(library, {
  suggestion: suggestion55,
  activeBucket: "large",
});
check(
  "a chip restricts to that folder only",
  chipped.every((g) => g.photos.every((p) => p.bucket === "large")),
);
check(
  "a chip never empties the list silently when that folder has files",
  chipped.reduce((n, g) => n + g.photos.length, 0) === 3,
);

const searched = groupPhotos(library, { suggestion: suggestion55, query: "airconic" });
check("a search collapses to one flat group", searched.length === 1);
check(
  "search results are best-first",
  searched[0].photos[0].filename.includes("55-"),
);
check(
  "search matches are case-insensitive and complete",
  searched[0].photos.length === 4,
);

const searchedNothing = groupPhotos(library, { query: "zzzz" });
check(
  "a search with no matches yields one empty group, not a crash",
  searchedNothing.length === 1 && searchedNothing[0].photos.length === 0,
);

check("an empty library yields no groups", groupPhotos([]).length === 0);

// ---------------------------------------------------------------------------
section("helpers");

check("matchesQuery ignores surrounding whitespace", matchesQuery(library[0], "  black  "));
check("an empty query matches everything", matchesQuery(library[0], ""));
check(
  "bucketCounts totals the library",
  (() => {
    const counts = bucketCounts(library);
    return (
      counts.small + counts.medium + counts.large + counts.other === library.length &&
      counts.small === 4
    );
  })(),
);
check(
  "BUCKET_ORDER puts unfiled photos last",
  BUCKET_ORDER[BUCKET_ORDER.length - 1] === "other",
);

// ---------------------------------------------------------------------------
console.log(
  `\n[1m${passed} passed, ${failed} failed[0m\n`,
);
if (failed > 0) process.exit(1);
