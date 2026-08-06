/**
 * One-time / re-runnable migration: loads the product catalog into MongoDB.
 *
 * Reads `data/products.csv` if it exists (expected columns: "Item Code",
 * "Description", "Regular Price", "Inventory", and optionally "Image",
 * "Hover Image" — a straight export of the source spreadsheet works as-is).
 * Falls back to `data/products.json` otherwise.
 *
 * Safe to run more than once: each row is upserted by Item Code, so
 * re-running after fixing a typo in the source file won't create duplicates
 * — it just overwrites that item's fields.
 *
 * Usage: npm run seed
 * (reads MONGODB_URI from .env.local; doesn't touch any other env tooling)
 */

import { MongoClient } from 'mongodb';
import { readFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const DEFAULT_STOCK = Number(process.env.SEED_DEFAULT_STOCK ?? 25);

interface SeedRow {
  itemCode: string;
  description: string;
  price: number;
  stock: number;
  image: string;
  hoverImage?: string;
}

function loadEnvLocal() {
  const envPath = path.join(ROOT, '.env.local');
  if (!existsSync(envPath)) return;
  const contents = readFileSync(envPath, 'utf8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function parsePrice(raw: string | number): number {
  if (typeof raw === 'number') return raw;
  return Number(raw.replace(/[^0-9.-]/g, ''));
}

async function loadRows(): Promise<SeedRow[]> {
  const csvPath = path.join(ROOT, 'data', 'products.csv');
  const jsonPath = path.join(ROOT, 'data', 'products.json');

  if (existsSync(csvPath)) {
    console.log(`Reading ${csvPath}`);
    const text = await readFile(csvPath, 'utf8');
    const rows = parseCsv(text);
    return rows
      .filter((row) => row['Item Code'])
      .map((row) => ({
        itemCode: row['Item Code'],
        description: row['Description'] ?? '',
        price: parsePrice(row['Regular Price'] ?? '0'),
        stock: row['Inventory'] ? Math.round(parsePrice(row['Inventory'])) : DEFAULT_STOCK,
        image: row['Image'] ? `/items/${row['Image']}` : '',
        hoverImage: row['Hover Image'] ? `/items/${row['Hover Image']}` : undefined,
      }));
  }

  if (existsSync(jsonPath)) {
    console.log(`Reading ${jsonPath}`);
    const text = await readFile(jsonPath, 'utf8');
    const items = JSON.parse(text) as Array<Record<string, unknown>>;
    return items.map((item) => ({
      itemCode: String(item.itemCode ?? item.id ?? ''),
      description: String(item.description ?? item.name ?? ''),
      price: parsePrice(item.price as string | number),
      stock: typeof item.stock === 'number' ? item.stock : DEFAULT_STOCK,
      image: String(item.image ?? ''),
      hoverImage: item.hoverImage ? String(item.hoverImage) : undefined,
    }));
  }

  throw new Error('No data/products.csv or data/products.json found to seed from.');
}

async function main() {
  loadEnvLocal();

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Add it to .env.local before running the seed script.');
  }

  const rows = await loadRows();
  const invalid = rows.filter((r) => !r.itemCode || !r.description);
  if (invalid.length > 0) {
    console.warn(`Skipping ${invalid.length} row(s) missing an Item Code or Description.`);
  }
  const valid = rows.filter((r) => r.itemCode && r.description);

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const products = client.db().collection('products');
    const now = new Date();

    const operations = valid.map((row) => ({
      updateOne: {
        filter: { _id: row.itemCode },
        update: {
          $set: {
            description: row.description,
            price: row.price,
            stock: row.stock,
            image: row.image,
            hoverImage: row.hoverImage,
            updatedAt: now,
          },
          $setOnInsert: { _id: row.itemCode, createdAt: now },
        },
        upsert: true,
      },
    }));

    if (operations.length === 0) {
      console.log('Nothing to seed.');
      return;
    }

    const result = await products.bulkWrite(operations as never);
    console.log(
      `Seeded ${valid.length} product(s) — ${result.upsertedCount} inserted, ${result.modifiedCount} updated.`
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
