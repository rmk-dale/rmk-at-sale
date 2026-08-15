/**
 * How a product size relates to the folder a photo sits in.
 *
 * `public/items/` is filed into `small/`, `medium/` and `large/`. A product's
 * sizes are labels like "55cm" and there may be two of them or five, so the
 * two schemes do not correspond one-to-one and never will. Everything in this
 * file therefore produces a *suggestion* for the admin picker: a ranking, not
 * a filter. Nothing here is stored, and nothing on the storefront reads it —
 * a saved path already names its own folder, so a wrong guess costs one extra
 * click and can never render a broken page.
 *
 * Deliberately dependency-free. No imports at all, not even types: this is
 * imported by client components, by the photos route, and by
 * scripts/check-photo-buckets.ts running under bare `node
 * --experimental-strip-types`, which cannot resolve the `@/` alias. Keeping
 * the module import-free means all three see identical behaviour and the
 * guessing rules can be tested without a browser or a database.
 */

export type PhotoBucket = "small" | "medium" | "large" | "other";

/** Buckets in display order. `other` last: it means "not filed yet". */
export const BUCKET_ORDER: PhotoBucket[] = ["small", "medium", "large", "other"];

export const BUCKET_LABELS: Record<PhotoBucket, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  other: "Unfiled",
};

/** One-character badge for a photo tile, where there is no room for a word. */
export const BUCKET_BADGES: Record<PhotoBucket, string> = {
  small: "S",
  medium: "M",
  large: "L",
  other: "?",
};

const KNOWN_BUCKETS: Record<string, PhotoBucket> = {
  small: "small",
  medium: "medium",
  large: "large",
};

/**
 * Classifies a file by the first path segment below `public/items/`.
 *
 * Expects a forward-slash relative directory ("small", "small/archive", or ""
 * at the top level) so this stays platform-independent — the caller
 * normalises `path.sep` before calling.
 *
 * Fails open: an unrecognised folder is `other` and the file is still listed.
 * Renaming `medium/` should cost a label in the picker, never a photo that can
 * no longer be found.
 */
export function bucketFromDir(dir: string): PhotoBucket {
  if (!dir) return "other";
  const first = dir.split("/")[0].trim().toLowerCase();
  return KNOWN_BUCKETS[first] ?? "other";
}

/** The minimum a photo needs to be ranked. Matches the photos API payload. */
export interface PhotoLike {
  filename: string;
  path: string;
  bucket: PhotoBucket;
}

// ---------------------------------------------------------------------------
// Reading a number out of a size label
// ---------------------------------------------------------------------------

/**
 * Longest plausible size number. Sizes here are luggage heights in cm — 55,
 * 67, 77 — so three digits is generous. The cap is what keeps style codes and
 * timestamps out: see `filenameNumbers`.
 */
const MAX_SIZE_DIGITS = 3;

/**
 * The numeric part of a size label: "55cm" -> 55, "SP79" -> 79, "One size" ->
 * undefined.
 *
 * Takes the first digit run short enough to be a size, so "55-67cm" reads as
 * 55 (the label's own leading value) rather than picking the larger number.
 */
export function sizeNumber(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const runs = label.match(/\d+/g);
  if (!runs) return undefined;
  for (const run of runs) {
    if (run.length <= MAX_SIZE_DIGITS) return Number(run);
  }
  return undefined;
}

/**
 * Every number in a filename that could plausibly be a size.
 *
 * Two rules, and both exist because of real filenames in this catalog:
 *
 * Screenshot names carry a date and a time — "Screenshot 2026-08-15
 * 185501.png". The date is stripped, and the time is discarded by the length
 * cap. Without either rule, a naive substring search for "55" finds it inside
 * "185501" and the picker confidently recommends a screenshot for every 55cm
 * variant.
 *
 * Whole digit runs are compared, never substrings, and only runs of at most
 * three digits count. That drops style codes ("145745-1011--8.jpg",
 * "128186_8162_..._5520_...") which encode the size but not as the size
 * label — those photos still rank on their folder, just not on their name.
 */
export function filenameNumbers(filename: string): number[] {
  const withoutDates = filename.replace(/\b20\d{2}[-_]\d{1,2}[-_]\d{1,2}\b/g, " ");
  const runs = withoutDates.match(/\d+/g);
  if (!runs) return [];
  const out: number[] = [];
  for (const run of runs) {
    if (run.length > MAX_SIZE_DIGITS) continue;
    const value = Number(run);
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/** True when the filename names this size as a whole number of its own. */
export function filenameMatchesSize(
  filename: string,
  size: number | undefined,
): boolean {
  if (size === undefined) return false;
  return filenameNumbers(filename).includes(size);
}

// ---------------------------------------------------------------------------
// Which bucket a size probably lives in
// ---------------------------------------------------------------------------

/**
 * Maps a size's position in the sorted run of sizes onto a folder.
 *
 * One size gets no preference at all — with nothing to compare against,
 * "smallest" is meaningless and a guess would be noise dressed as a hint.
 * Two sizes are read as the extremes. Four or more put the ends in `small`
 * and `large` and everything between in `medium`, which is the only honest
 * reading of three folders holding five sizes.
 */
export function bucketForSizeIndex(
  index: number,
  total: number,
): PhotoBucket | undefined {
  if (total <= 1) return undefined;
  if (index <= 0) return "small";
  if (index >= total - 1) return "large";
  return "medium";
}

export interface SizeSuggestion {
  /** The label this suggestion is for, or undefined when there is no size context. */
  label?: string;
  /** Its numeric part, if it has one. */
  number?: number;
  /** The folder it probably lives in, if that can be inferred. */
  bucket?: PhotoBucket;
}

/**
 * Works out what to lead with for one size, given every size on the product.
 *
 * Sorts a *copy* — `allSizes` arrives as a prop and mutating it would reorder
 * the size row on the storefront as a side effect of opening a picker.
 * Sizes with no readable number sort last, keeping their relative order, so a
 * stray "One size" cannot displace the numeric run.
 */
export function suggestFor(
  sizeLabel: string | undefined,
  allSizes: string[] | undefined,
): SizeSuggestion {
  if (!sizeLabel) return {};

  const number = sizeNumber(sizeLabel);
  const sizes = allSizes ?? [];

  if (sizes.length === 0) return { label: sizeLabel, number };

  const ranked = sizes
    .map((label, originalIndex) => ({ label, originalIndex, value: sizeNumber(label) }))
    .sort((a, b) => {
      if (a.value === undefined && b.value === undefined) {
        return a.originalIndex - b.originalIndex;
      }
      if (a.value === undefined) return 1;
      if (b.value === undefined) return -1;
      if (a.value !== b.value) return a.value - b.value;
      return a.originalIndex - b.originalIndex;
    });

  const index = ranked.findIndex((s) => s.label === sizeLabel);
  const bucket =
    index === -1 ? undefined : bucketForSizeIndex(index, ranked.length);

  return { label: sizeLabel, number, bucket };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * How well one photo fits a size. Higher is better; 0 is "no signal".
 *
 * The name is weighted above the folder because it is the stronger evidence:
 * this catalog is named "Airconic black 55-1.JPG" / "Maxivo SP68 Red-2.jpeg",
 * so a name carrying the size is close to a statement of fact, where a folder
 * is only a statement about which of three piles it was thrown into.
 */
export function scorePhotoForSize(
  photo: PhotoLike,
  suggestion: SizeSuggestion,
): number {
  const nameHit = filenameMatchesSize(photo.filename, suggestion.number);
  const bucketHit =
    suggestion.bucket !== undefined && photo.bucket === suggestion.bucket;
  if (nameHit && bucketHit) return 3;
  if (nameHit) return 2;
  if (bucketHit) return 1;
  return 0;
}

export interface PhotoGroup<T extends PhotoLike> {
  key: string;
  title: string;
  photos: T[];
}

/** Case-insensitive substring match on the filename. Empty query matches all. */
export function matchesQuery(photo: PhotoLike, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return photo.filename.toLowerCase().includes(trimmed);
}

export function bucketCounts<T extends PhotoLike>(
  photos: T[],
): Record<PhotoBucket, number> {
  const counts: Record<PhotoBucket, number> = {
    small: 0,
    medium: 0,
    large: 0,
    other: 0,
  };
  for (const photo of photos) counts[photo.bucket] += 1;
  return counts;
}

/**
 * Splits photos into a "suggested for this size" group and the rest.
 *
 * Only a filename hit earns the suggested group. A folder match alone is too
 * weak to headline — `small/` holds 78 files and most of them are not this
 * variant — so it only orders the remainder. Nothing is ever dropped: the
 * two groups together are always every photo passed in, which is what makes
 * this safe to apply by default.
 */
export function partitionForSize<T extends PhotoLike>(
  photos: T[],
  suggestion: SizeSuggestion,
): { suggested: T[]; rest: T[] } {
  const suggested: T[] = [];
  const rest: T[] = [];

  for (const photo of photos) {
    if (scorePhotoForSize(photo, suggestion) >= 2) suggested.push(photo);
    else rest.push(photo);
  }

  const byScoreThenName = (a: T, b: T) => {
    const diff = scorePhotoForSize(b, suggestion) - scorePhotoForSize(a, suggestion);
    if (diff !== 0) return diff;
    const byBucket =
      BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket);
    if (byBucket !== 0) return byBucket;
    return a.filename.localeCompare(b.filename);
  };

  suggested.sort(byScoreThenName);
  rest.sort(byScoreThenName);
  return { suggested, rest };
}

/**
 * The groups a picker should render, in order.
 *
 * `activeBucket` is the chip the admin has selected; `undefined` means "all".
 * With a size in context and no chip chosen, the result is: what we think you
 * want, then that size's likely folder, then everything else by folder.
 */
export function groupPhotos<T extends PhotoLike>(
  photos: T[],
  options: {
    suggestion?: SizeSuggestion;
    activeBucket?: PhotoBucket;
    query?: string;
  } = {},
): PhotoGroup<T>[] {
  const { suggestion = {}, activeBucket, query = "" } = options;

  const visible = photos.filter(
    (photo) =>
      matchesQuery(photo, query) &&
      (activeBucket === undefined || photo.bucket === activeBucket),
  );

  // A search is a direct instruction: the admin has named what they want, so
  // showing it as one flat, best-first list beats scattering three matches
  // across four collapsed-looking headings.
  if (query.trim()) {
    const { suggested, rest } = partitionForSize(visible, suggestion);
    return [
      {
        key: "results",
        title: `${visible.length} match${visible.length === 1 ? "" : "es"}`,
        photos: [...suggested, ...rest],
      },
    ];
  }

  const groups: PhotoGroup<T>[] = [];
  const { suggested, rest } = partitionForSize(visible, suggestion);

  if (suggestion.label && suggested.length > 0) {
    groups.push({
      key: "suggested",
      title: `Suggested for ${suggestion.label}`,
      photos: suggested,
    });
  }

  const remainder = suggestion.label && suggested.length > 0 ? rest : visible;
  const bucketsPresent = BUCKET_ORDER.filter((bucket) =>
    remainder.some((photo) => photo.bucket === bucket),
  );

  // Order the folders so the size's own folder comes first when we have a
  // guess, rather than always small → large.
  const ordered =
    suggestion.bucket && bucketsPresent.includes(suggestion.bucket)
      ? [suggestion.bucket, ...bucketsPresent.filter((b) => b !== suggestion.bucket)]
      : bucketsPresent;

  for (const bucket of ordered) {
    const inBucket = remainder
      .filter((photo) => photo.bucket === bucket)
      .sort((a, b) => a.filename.localeCompare(b.filename));
    if (inBucket.length === 0) continue;
    groups.push({
      key: bucket,
      title:
        groups.length > 0 && groups[0].key === "suggested"
          ? `Rest of ${BUCKET_LABELS[bucket]}`
          : BUCKET_LABELS[bucket],
      photos: inBucket,
    });
  }

  return groups;
}
