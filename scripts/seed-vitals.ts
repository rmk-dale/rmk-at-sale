/**
 * Fills the `webVitals` collection with synthetic samples so the admin
 * Performance tab can be reviewed before real traffic exists.
 *
 * Also verifies the p75 aggregation the dashboard depends on, by running
 * the same pipeline against a known set of values and comparing against a
 * percentile computed independently in JS. A percentile is exactly the
 * kind of thing that is wrong by one array position for months without
 * anyone noticing, because the number still looks plausible.
 *
 * Usage:
 *   npm run seed:vitals          seed ~7 days of samples, then verify
 *   npm run seed:vitals -- --verify-only   run only the p75 check
 *   npm run seed:vitals -- --clear         remove all seeded samples
 *
 * Everything it writes is marked `seeded: true`, so `--clear` removes the
 * fake data without touching anything real that may have arrived since.
 */

import { MongoClient, ObjectId } from "mongodb";
import dns from "dns";
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {}
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const contents = readFileSync(envPath, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set (looked in .env.local).");
  process.exit(1);
}

const THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
} as const;

type MetricName = keyof typeof THRESHOLDS;

function rateValue(name: MetricName, value: number) {
  const { good, poor } = THRESHOLDS[name];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

/**
 * Log-normal-ish draw: mostly clustered near `median`, with a long right
 * tail. Real web-vitals distributions are heavily right-skewed — a uniform
 * random sample would produce a p75 that sits nowhere near where a real
 * one does, which would make the seeded dashboard actively misleading
 * about what to expect.
 */
function skewedSample(median: number): number {
  const u = Math.random();
  const spread = Math.exp((u - 0.5) * 1.6);
  const tail = Math.random() < 0.08 ? 1 + Math.random() * 2.5 : 1;
  return median * spread * tail;
}

const ROUTES: { route: string; weight: number; slowness: number }[] = [
  { route: "/", weight: 5, slowness: 1 },
  { route: "/product/[id]", weight: 4, slowness: 1.35 },
  { route: "/cart", weight: 1, slowness: 0.9 },
];

const MEDIANS: Record<MetricName, number> = {
  LCP: 1900,
  INP: 130,
  CLS: 0.06,
  FCP: 1200,
  TTFB: 520,
};

const SAMPLE_DAYS = 7;
const PAGE_VIEWS_PER_DAY = 220;

function pickRoute() {
  const total = ROUTES.reduce((sum, r) => sum + r.weight, 0);
  let n = Math.random() * total;
  for (const r of ROUTES) {
    n -= r.weight;
    if (n <= 0) return r;
  }
  return ROUTES[0];
}

async function seed(collection: ReturnType<typeof getCollection>) {
  const docs: Record<string, unknown>[] = [];
  const now = Date.now();

  for (let day = 0; day < SAMPLE_DAYS; day++) {
    for (let view = 0; view < PAGE_VIEWS_PER_DAY; view++) {
      const route = pickRoute();
      const device = Math.random() < 0.62 ? "mobile" : "desktop";
      // Mobile is genuinely slower; making it identical to desktop would
      // hide the one split the device filter exists to reveal.
      const deviceFactor = device === "mobile" ? 1.45 : 1;

      const at = new Date(
        now - day * 86_400_000 - Math.random() * 86_400_000,
      );

      for (const name of Object.keys(MEDIANS) as MetricName[]) {
        // INP only exists once someone interacts, so it is genuinely
        // missing from most page views.
        if (name === "INP" && Math.random() < 0.55) continue;

        const value =
          name === "CLS"
            ? Number(skewedSample(MEDIANS[name]).toFixed(4))
            : Math.round(
                skewedSample(MEDIANS[name]) * route.slowness * deviceFactor,
              );

        docs.push({
          _id: new ObjectId(),
          at,
          name,
          value,
          rating: rateValue(name, value),
          route: route.route,
          navigationType: Math.random() < 0.85 ? "navigate" : "back-forward",
          device,
          seeded: true,
        });
      }
    }
  }

  await collection.insertMany(docs as never, { ordered: false });
  console.log(
    `Seeded ${docs.length.toLocaleString()} samples across ${SAMPLE_DAYS} days.`,
  );
}

/** Nearest-rank p75, computed in plain JS as the reference answer. */
function p75InJs(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(0.75 * sorted.length) - 1),
  );
  return sorted[index];
}

/**
 * Runs the dashboard's p75 expression against a fixed set of values and
 * compares it to the JS reference, for several array lengths — the
 * off-by-one only shows up at particular sizes, so checking one length
 * would pass while the pipeline was still wrong.
 */
async function verify(db: ReturnType<MongoClient["db"]>) {
  const cases: number[][] = [
    [10],
    [10, 20],
    [10, 20, 30, 40],
    [5, 1, 4, 2, 3],
    [100, 200, 300, 400, 500, 600, 700, 800],
    Array.from({ length: 1000 }, (_, i) => i + 1),
  ];

  const temp = db.collection("webVitalsP75Check");
  await temp.deleteMany({});

  let failures = 0;

  for (const [caseIndex, values] of cases.entries()) {
    await temp.insertMany(
      values.map((value) => ({ caseIndex, value })),
    );
  }

  const p75Expr = {
    $let: {
      vars: { sorted: { $sortArray: { input: "$values", sortBy: 1 } } },
      in: {
        $arrayElemAt: [
          "$$sorted",
          {
            $max: [
              0,
              {
                $min: [
                  { $subtract: [{ $size: "$$sorted" }, 1] },
                  {
                    $subtract: [
                      { $ceil: { $multiply: [0.75, { $size: "$$sorted" }] } },
                      1,
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };

  const rows = await temp
    .aggregate([
      { $group: { _id: "$caseIndex", values: { $push: "$value" } } },
      { $set: { p75: p75Expr } },
      { $project: { p75: 1 } },
    ])
    .toArray();

  for (const row of rows) {
    const expected = p75InJs(cases[row._id as number]);
    const ok = row.p75 === expected;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  n=${String(
        cases[row._id as number].length,
      ).padStart(4)}  pipeline=${row.p75}  expected=${expected}`,
    );
  }

  await temp.drop();

  if (failures > 0) {
    console.error(`\np75 verification FAILED (${failures} case(s)).`);
    process.exitCode = 1;
  } else {
    console.log("\np75 aggregation matches the reference on every case.");
  }
}

function getCollection(db: ReturnType<MongoClient["db"]>) {
  return db.collection("webVitals");
}

async function main() {
  const args = process.argv.slice(2);
  const client = new MongoClient(uri!, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  const db = client.db();
  const collection = getCollection(db);

  try {
    if (args.includes("--clear")) {
      const { deletedCount } = await collection.deleteMany({ seeded: true });
      console.log(`Removed ${deletedCount} seeded samples.`);
      return;
    }

    if (!args.includes("--verify-only")) {
      await seed(collection);
    }

    console.log("\nVerifying p75 aggregation:");
    await verify(db);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
