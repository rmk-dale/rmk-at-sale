import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import path from "path";
import { requireAdmin } from "@/lib/adminGuard";
import {
  BUCKET_ORDER,
  bucketFromDir,
  type PhotoBucket,
} from "@/lib/photoBuckets";

const ITEMS_DIR = path.join(process.cwd(), "public", "items");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

/**
 * How deep below `public/items/` to look.
 *
 * The filing scheme is one level (`small/`, `medium/`, `large/`), so 2 covers
 * it with room for one accidental nesting. A bound rather than an unbounded
 * walk because this runs on every admin form mount and the directory is
 * hand-edited — a deep tree dropped in there should make the picker miss a
 * folder, not hang the route.
 */
const MAX_DEPTH = 2;

export interface PhotoEntry {
  filename: string;
  /** Public URL, e.g. "/items/small/Airconic black 55-1.JPG". */
  path: string;
  /** Which size folder it sits in. Derived here, never stored — see lib/photoBuckets.ts. */
  bucket: PhotoBucket;
  /** Directory relative to public/items, "" at the top level. */
  dir: string;
}

async function walk(
  absoluteDir: string,
  relativeDir: string,
  depth: number,
  out: PhotoEntry[],
): Promise<void> {
  // `withFileTypes` avoids a stat per entry. It also means a symlink reports
  // as neither file nor directory, so it is skipped without ever being
  // followed — a link pointing outside public/ cannot be enumerated into the
  // picker, and a link pointing at its own parent cannot loop this walk.
  const entries = await readdir(absoluteDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (depth >= MAX_DEPTH) continue;
      await walk(
        path.join(absoluteDir, entry.name),
        relativeDir ? `${relativeDir}/${entry.name}` : entry.name,
        depth + 1,
        out,
      );
      continue;
    }

    if (!entry.isFile()) continue;
    if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    // `relativeDir` is accumulated with "/" rather than path.join so the URL
    // is correct on Windows too, where join would produce backslashes. Every
    // segment comes from readdir, so no caller-supplied string reaches this.
    out.push({
      filename: entry.name,
      path: relativeDir
        ? `/items/${relativeDir}/${entry.name}`
        : `/items/${entry.name}`,
      bucket: bucketFromDir(relativeDir),
      dir: relativeDir,
    });
  }
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const files: PhotoEntry[] = [];
    await walk(ITEMS_DIR, "", 0, files);

    files.sort((a, b) => {
      const byBucket =
        BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket);
      if (byBucket !== 0) return byBucket;
      return a.filename.localeCompare(b.filename);
    });

    return NextResponse.json(files);
  } catch (error) {
    console.error("Error listing product photos:", error);
    return NextResponse.json(
      { error: "Could not read the photos directory." },
      { status: 500 },
    );
  }
}
