/**
 * End-to-end check for lib/rateLimit.ts against whichever backend is
 * configured. Run this from your machine (not CI) after setting the
 * Upstash credentials — it is the only way to confirm the Lua sliding
 * window actually behaves, since that code path never runs in tests.
 *
 *   npm run check:ratelimit
 *
 * Exercises three properties that matter:
 *   1. the limit is enforced sequentially
 *   2. the limit holds under concurrency (this is what the Lua script is
 *      for — a naive read-then-write limiter fails here)
 *   3. the window actually expires
 *
 * Writes only to `rl:selftest:*` keys, which carry a short TTL and expire
 * on their own.
 */
import { readFileSync, existsSync } from "fs";
import path from "path";

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
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const configured = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

console.log(
  configured
    ? "Backend: Upstash Redis (distributed sliding window)"
    : "Backend: in-process fallback — set UPSTASH_REDIS_REST_* to test the real one",
);

const { checkRateLimit } = await import("../lib/rateLimit.ts");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

const rule = { limit: 3, windowMs: 4000 };

// 1. Sequential enforcement.
const key = `selftest:seq:${Date.now()}`;
const seq = [];
for (let i = 0; i < 5; i++) seq.push(await checkRateLimit(key, rule));
check(
  "first 3 admitted, next 2 refused",
  seq.slice(0, 3).every((r) => r.ok) && seq.slice(3).every((r) => !r.ok),
  seq.map((r) => (r.ok ? "allow" : "deny")).join(" "),
);
check(
  "refusal carries a positive Retry-After",
  seq[4].retryAfterSeconds > 0,
  `${seq[4].retryAfterSeconds}s`,
);

// 2. Concurrency. Ten requests fired at once against a limit of three must
//    admit exactly three. A read-then-write limiter typically admits more.
const raceKey = `selftest:race:${Date.now()}`;
const race = await Promise.all(
  Array.from({ length: 10 }, () => checkRateLimit(raceKey, rule)),
);
const admitted = race.filter((r) => r.ok).length;
check(
  "exactly 3 of 10 concurrent requests admitted",
  admitted === 3,
  `${admitted} admitted`,
);

// 3. Window expiry.
console.log("  … waiting out the window");
await new Promise((r) => setTimeout(r, rule.windowMs + 500));
const afterExpiry = await checkRateLimit(key, rule);
check("admitted again once the window has passed", afterExpiry.ok);

console.log(failed === 0 ? "\nAll rate limit checks passed.\n" : `\n${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
