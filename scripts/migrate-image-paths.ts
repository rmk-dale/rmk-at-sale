/**
 * Repoints stored photo paths at the size-bucket folders.
 *
 * `public/items/` was reorganised into `small/`, `medium/`, `large/`. Every
 * path already in MongoDB is flat (`/items/<file>`) while the bytes now live
 * at `/items/<bucket>/<file>`, so every product photo on the storefront is a
 * 404 until this runs.
 *
 * Rewrites, on every product document:
 *   - `image`, `hoverImage`
 *   - `colors[].image`, `colors[].hoverImage`
 *   - `variants[].image`, `variants[].hoverImage`
 *
 *   node --experimental-strip-types scripts/migrate-image-paths.ts            (dry run)
 *   node --experimental-strip-types scripts/migrate-image-paths.ts --apply    (writes)
 *
 * Safe properties, in the order they matter:
 *
 *   Idempotent. A path that already names a directory below /items/ is left
 *   untouched, so a second run is a no-op and a half-finished run can simply
 *   be re-run.
 *
 *   Fails closed. If a filename cannot be located on disk, or matches two
 *   files in different buckets, that path is reported and NOTHING is written
 *   for it. The script exits non-zero so a script-driven deploy stops.
 *
 *   Concurrency-safe. Each document is written under a filter that pins the
 *   `updatedAt` it was read at, so an admin who saves an edit mid-migration
 *   cannot have their write silently overwritten — that document is skipped
 *   and reported instead.
 *
 *   Cheap. One bulkWrite, not one update per document, to stay well inside
 *   the M0 ops budget.
 *
 * Deliberately self-contained: no `@/` alias imports, so it runs under bare
 * node with no bundler (see the note in scripts/security-checks.ts).
 */
import { MongoClient, type AnyBulkWriteOperation } from "mongodb";
import dns from "dns";
import { readdirSync, readFileSync, existsSync } from "fs";
import path from "path";

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {
  // Ignore in environments where this isn't allowed.
}

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

const ITEMS_DIR = path.join(process.cwd(), "public", "items");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const MAX_DEPTH = 2;

const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const DIM = "[2m";
const BOLD = "[1m";
const RESET = "[0m";

// ---------------------------------------------------------------------------
// The on-disk index
// ---------------------------------------------------------------------------

interface DiskFile {
  /** Public URL including the bucket directory. */
  url: string;
  /** Exact basename as it appears on disk. */
  filename: string;
}

/**
 * basename (lowercased) -> every file on disk with that basename.
 *
 * Keyed case-insensitively on purpose. The catalog mixes `.JPG` and `.jpg`,
 * and a path whose case doesn't match the file is the classic bug that works
 * on a case-insensitive dev filesystem and 404s once deployed to Linux. This
 * way a case mismatch is found, corrected, and reported rather than silently
 * left to break in production.
 *
 * An array rather than a single value because two buckets could hold the same
 * basename. That is ambiguous and must be refused, not guessed at.
 */
function indexDisk(): Map<string, DiskFile[]> {
  const index = new Map<string, DiskFile[]>();

  function walk(absoluteDir: string, relativeDir: string, depth: number) {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (depth >= MAX_DEPTH) continue;
        walk(
          path.join(absoluteDir, entry.name),
          relativeDir ? `${relativeDir}/${entry.name}` : entry.name,
          depth + 1,
        );
        continue;
      }
      if (!entry.isFile()) continue;
      if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

      const url = relativeDir
        ? `/items/${relativeDir}/${entry.name}`
        : `/items/${entry.name}`;
      const key = entry.name.toLowerCase();
      const existing = index.get(key);
      if (existing) existing.push({ url, filename: entry.name });
      else index.set(key, [{ url, filename: entry.name }]);
    }
  }

  walk(ITEMS_DIR, "", 0);
  return index;
}

// ---------------------------------------------------------------------------
// Resolving one stored path
// ---------------------------------------------------------------------------

type Resolution =
  | { kind: "rewrite"; to: string; reason: "moved" | "case" }
  | { kind: "keep" }
  | { kind: "unresolved"; why: string };

/**
 * Decides what should happen to one stored path.
 *
 * Order matters here. "Already has a directory" is checked before any lookup,
 * because that is what makes the script idempotent — a bucketed path is left
 * alone even if its basename is ambiguous, since it is already unambiguous by
 * virtue of naming its own folder.
 */
function resolve(stored: string, index: Map<string, DiskFile[]>): Resolution {
  if (!stored) return { kind: "keep" };

  // Not one of ours: /home-image.png, an absolute URL, whatever. Not this
  // script's business.
  if (!stored.startsWith("/items/")) return { kind: "keep" };

  const rest = stored.slice("/items/".length);
  if (!rest) return { kind: "unresolved", why: "path is just /items/" };

  const segments = rest.split("/");

  // Percent-encoding: these filenames contain spaces and parentheses
  // ("S (1).png"), so a stored value may or may not have been encoded
  // depending on how it was produced. Decode for matching; the URL we write
  // back uses the raw on-disk name, which is what the working paths already
  // look like.
  const rawBasename = segments[segments.length - 1];
  let basename = rawBasename;
  try {
    basename = decodeURIComponent(rawBasename);
  } catch {
    // Malformed escape — match on the raw form instead of throwing.
  }

  const candidates = index.get(basename.toLowerCase());

  // Already bucketed. Verify it still exists so a stale path gets reported
  // rather than quietly passed over, but do not move it.
  if (segments.length > 1) {
    const hit = candidates?.find((c) => c.url === stored);
    if (hit) return { kind: "keep" };
    // Same file, different case in the path: correct it. This is the case
    // that works on Windows and 404s on Vercel.
    const caseHit = candidates?.find(
      (c) => c.url.toLowerCase() === stored.toLowerCase(),
    );
    if (caseHit) return { kind: "rewrite", to: caseHit.url, reason: "case" };
    return {
      kind: "unresolved",
      why: "already has a folder but no such file on disk",
    };
  }

  if (!candidates || candidates.length === 0) {
    return { kind: "unresolved", why: "no file with this name under public/items" };
  }
  if (candidates.length > 1) {
    return {
      kind: "unresolved",
      why: `ambiguous — ${candidates.length} files share this name (${candidates
        .map((c) => c.url)
        .join(", ")})`,
    };
  }

  const target = candidates[0];
  if (target.url === stored) return { kind: "keep" };
  return { kind: "rewrite", to: target.url, reason: "moved" };
}

// ---------------------------------------------------------------------------
// Walking a document
// ---------------------------------------------------------------------------

interface ProductLike {
  _id: string;
  name?: string;
  description?: string;
  updatedAt?: Date;
  image?: string;
  hoverImage?: string;
  colors?: { image?: string; hoverImage?: string }[];
  variants?: { color?: string; size?: string; image?: string; hoverImage?: string }[];
}

interface Problem {
  productId: string;
  label: string;
  field: string;
  stored: string;
  why: string;
}

interface Rewrite {
  productId: string;
  label: string;
  field: string;
  from: string;
  to: string;
  reason: "moved" | "case";
}

function main() {
  loadEnvLocal();

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error(`${RED}MONGODB_URI is not set (looked in .env.local).${RESET}`);
    process.exit(1);
  }
  if (!existsSync(ITEMS_DIR)) {
    console.error(`${RED}No such directory: ${ITEMS_DIR}${RESET}`);
    process.exit(1);
  }

  const index = indexDisk();
  const fileCount = [...index.values()].reduce((n, v) => n + v.length, 0);
  const collisions = [...index.entries()].filter(([, v]) => v.length > 1);

  console.log(
    `\n${BOLD}Image path migration${RESET} ${DIM}(${APPLY ? "APPLY" : "dry run"})${RESET}`,
  );
  console.log(`  ${fileCount} image files under public/items/`);
  if (collisions.length > 0) {
    console.log(
      `  ${YELLOW}${collisions.length} basename(s) appear in more than one folder:${RESET}`,
    );
    for (const [, files] of collisions.slice(0, 20)) {
      console.log(`    ${files.map((f) => f.url).join("  vs  ")}`);
    }
    console.log(
      `  ${DIM}Flat paths with these names cannot be resolved automatically.${RESET}`,
    );
  }

  run(uri, index).catch((error) => {
    console.error(`${RED}Migration failed:${RESET}`, error);
    process.exit(1);
  });
}

async function run(uri: string, index: Map<string, DiskFile[]>) {
  const client = new MongoClient(uri);
  await client.connect();

  try {
    const products = client.db().collection<ProductLike>("products");
    const all = await products.find().sort({ _id: 1 }).toArray();

    const problems: Problem[] = [];
    const rewrites: Rewrite[] = [];
    const operations: AnyBulkWriteOperation<ProductLike>[] = [];
    const referenced = new Set<string>();

    for (const doc of all) {
      const label = doc.name || doc.description || doc._id;
      const set: Record<string, unknown> = {};

      /** Resolves one path, recording the outcome, and returns what to store. */
      const take = (field: string, stored: string | undefined): string | undefined => {
        if (!stored) return stored;
        referenced.add(stored);
        const result = resolve(stored, index);
        if (result.kind === "keep") return stored;
        if (result.kind === "unresolved") {
          problems.push({
            productId: doc._id,
            label,
            field,
            stored,
            why: result.why,
          });
          return stored;
        }
        rewrites.push({
          productId: doc._id,
          label,
          field,
          from: stored,
          to: result.to,
          reason: result.reason,
        });
        return result.to;
      };

      const nextImage = take("image", doc.image);
      if (nextImage !== doc.image) set.image = nextImage;

      const nextHover = take("hoverImage", doc.hoverImage);
      if (nextHover !== doc.hoverImage) set.hoverImage = nextHover;

      // Nested arrays are rewritten whole rather than by positional path.
      // `colors.$[].image` would need an arrayFilter per element to be
      // conditional, and rebuilding the array from the document we just read
      // — spreading each element so untouched fields survive — is both
      // simpler and easier to be sure about.
      if (Array.isArray(doc.colors)) {
        let colorsChanged = false;
        const nextColors = doc.colors.map((color, i) => {
          const image = take(`colors[${i}].image`, color.image);
          const hoverImage = take(`colors[${i}].hoverImage`, color.hoverImage);
          if (image === color.image && hoverImage === color.hoverImage) return color;
          colorsChanged = true;
          return { ...color, image, hoverImage };
        });
        if (colorsChanged) set.colors = nextColors;
      }

      if (Array.isArray(doc.variants)) {
        let variantsChanged = false;
        const nextVariants = doc.variants.map((variant, i) => {
          const cell =
            [variant.color, variant.size].filter(Boolean).join(" ") || `#${i}`;
          const image = take(`variants[${cell}].image`, variant.image);
          const hoverImage = take(
            `variants[${cell}].hoverImage`,
            variant.hoverImage,
          );
          if (image === variant.image && hoverImage === variant.hoverImage) {
            return variant;
          }
          variantsChanged = true;
          return { ...variant, image, hoverImage };
        });
        if (variantsChanged) set.variants = nextVariants;
      }

      if (Object.keys(set).length === 0) continue;

      operations.push({
        updateOne: {
          // `updatedAt` pins the version this was read at. If an admin saves
          // between the read above and this write, the filter misses and the
          // document is left alone — reported below as a skip rather than
          // clobbering their edit. Deliberately does NOT $set updatedAt: a
          // mechanical path fix is not a content edit and shouldn't look like
          // one in the admin list.
          filter: { _id: doc._id, updatedAt: doc.updatedAt },
          update: { $set: set },
        },
      });
    }

    // ---- report -----------------------------------------------------------

    console.log(`\n  ${all.length} product documents scanned`);
    console.log(`  ${rewrites.length} path(s) need rewriting`);
    console.log(`  ${operations.length} document(s) affected`);

    const moved = rewrites.filter((r) => r.reason === "moved").length;
    const cased = rewrites.filter((r) => r.reason === "case").length;
    if (cased > 0) {
      console.log(
        `  ${YELLOW}${cased} of those are case-only corrections${RESET} ${DIM}(would 404 on Linux, work locally)${RESET}`,
      );
    }
    if (moved > 0) console.log(`  ${moved} moved into a bucket folder`);

    if (VERBOSE) {
      for (const r of rewrites) {
        console.log(
          `    ${DIM}${r.label}${RESET} ${r.field}\n      ${r.from}\n   -> ${r.to}`,
        );
      }
    }

    const orphans = [...index.values()]
      .flat()
      .filter((f) => !referenced.has(f.url)).length;
    console.log(
      `  ${DIM}${orphans} file(s) on disk are not referenced by any product${RESET}`,
    );

    if (problems.length > 0) {
      console.log(`\n  ${RED}${problems.length} path(s) could not be resolved:${RESET}`);
      for (const p of problems) {
        console.log(`    ${p.label} ${DIM}(${p.productId})${RESET}`);
        console.log(`      ${p.field} = ${p.stored}`);
        console.log(`      ${YELLOW}${p.why}${RESET}`);
      }
      console.log(
        `\n  ${RED}Refusing to write.${RESET} Fix these — put the file back under` +
          ` public/items/, or clear the field in the admin form — then re-run.`,
      );
      console.log(
        `  ${DIM}Nothing above was applied; this script writes all-or-nothing.${RESET}\n`,
      );
      process.exit(1);
    }

    if (operations.length === 0) {
      console.log(
        `\n  ${GREEN}Nothing to do.${RESET} Every stored path already points at a real file.\n`,
      );
      return;
    }

    if (!APPLY) {
      console.log(
        `\n  ${YELLOW}Dry run — nothing written.${RESET} Re-run with --apply to commit` +
          ` (and --verbose to list every rewrite).`,
      );
      console.log(
        `  ${DIM}Take an Atlas snapshot first: this is not reversible from the database alone.${RESET}\n`,
      );
      return;
    }

    const result = await products.bulkWrite(operations, { ordered: false });
    const skipped = operations.length - result.matchedCount;

    console.log(`\n  ${GREEN}Applied.${RESET} ${result.modifiedCount} document(s) updated.`);
    if (skipped > 0) {
      console.log(
        `  ${YELLOW}${skipped} document(s) were skipped${RESET} because they changed` +
          ` while this ran (someone saved in the admin). Re-run to pick them up.`,
      );
    }
    console.log(
      `  ${DIM}The storefront cache is 15s, so pages self-heal shortly; redeploy` +
        ` if you want it immediate.${RESET}\n`,
    );
  } finally {
    await client.close();
  }
}

main();
