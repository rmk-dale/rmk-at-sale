import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import path from "path";
import { requireAdmin } from "@/lib/adminGuard";

const ITEMS_DIR = path.join(process.cwd(), "public", "items");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const entries = await readdir(ITEMS_DIR, { withFileTypes: true });
    const files = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
      )
      .map((entry) => ({ filename: entry.name, path: `/items/${entry.name}` }))
      .sort((a, b) => a.filename.localeCompare(b.filename));

    return NextResponse.json(files);
  } catch (error) {
    console.error("Error listing product photos:", error);
    return NextResponse.json(
      { error: "Could not read the photos directory." },
      { status: 500 },
    );
  }
}
