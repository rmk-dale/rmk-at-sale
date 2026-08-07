import crypto from "crypto";

/**
 * Distributed rate limiting, backed by Upstash Redis over its REST API.
 *
 * Why REST and not `@upstash/ratelimit`: the REST endpoint is a plain
 * fetch, so this adds no dependency, no cold-start cost, and works
 * unchanged on both the Node and Edge runtimes. The algorithm below is a
 * sliding-window log implemented as a single Lua script, so counting and
 * admitting happen atomically in one round trip — two containers racing on
 * the same key cannot both be admitted past the limit.
 *
 * Why Redis and not Mongo: these counters are written on every attempt
 * against the auth endpoints, they are worthless after their window
 * expires, and they must be correct under concurrency from many Vercel
 * containers at once. That is precisely Redis's job, and it keeps
 * brute-force traffic off the Atlas cluster that serves real orders.
 *
 * Required environment variables:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * If they are missing in production this module FAILS CLOSED — protected
 * endpoints reject rather than run unmetered. In development it falls back
 * to an in-process limiter so `next dev` works with no extra setup.
 */

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const IS_CONFIGURED = Boolean(REST_URL && REST_TOKEN);

if (!IS_CONFIGURED && IS_PRODUCTION) {
  console.error(
    "[rateLimit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set. " +
      "Rate-limited endpoints will reject all requests until they are configured.",
  );
}

export interface RateLimitRule {
  /** Maximum number of attempts permitted inside the window. */
  limit: number;
  /** Width of the sliding window, in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Attempts left in the current window. */
  remaining: number;
  /** Seconds until the caller may retry. 0 when `ok`. */
  retryAfterSeconds: number;
}

/**
 * Central table of limits. Kept in one place so the blast radius of a
 * tuning change is obvious and so no endpoint silently ships unprotected.
 *
 * The per-identifier limits are the ones that actually stop a targeted
 * brute force; the per-IP limits stop the cheap broad version of the same
 * attack. Both apply, and the tighter of the two wins.
 */
export const RATE_LIMITS = {
  /** Sending a checkout code. Protects the SMTP account from being used as a relay. */
  otpRequestPerIp: { limit: 5, windowMs: 15 * 60_000 },
  otpRequestPerEmail: { limit: 3, windowMs: 15 * 60_000 },

  /**
   * Total checkout codes sent site-wide per hour, across every IP and
   * every address.
   *
   * The per-IP and per-email limits above bound one attacker or one
   * victim; neither bounds the sum. Someone spraying a few hundred proxy
   * IPs across many different target addresses stays under both while
   * still pushing thousands of sends an hour through the SMTP account —
   * enough to exhaust the quota and get the sending domain blacklisted.
   *
   * This is the ceiling on total blast radius. It has to be shared across
   * containers to mean anything, which is exactly why it lives in Redis
   * and not in process memory.
   *
   * Sized well above plausible real traffic for a store this size: if it
   * ever trips, that is a signal worth investigating, not a limit worth
   * quietly raising.
   */
  otpSendGlobal: { limit: 500, windowMs: 60 * 60_000 },

  /**
   * Guessing a checkout code. The per-challenge attempt counter in
   * lib/models/otpChallenge.ts is the real defence (5 tries, then the
   * challenge is burned); this stops an attacker from cheaply cycling
   * through fresh challenges to reset that counter.
   */
  otpVerifyPerIp: { limit: 15, windowMs: 15 * 60_000 },

  /** Admin password attempts. Complements the per-account DB lockout. */
  adminLoginPerIp: { limit: 10, windowMs: 15 * 60_000 },
  adminLoginPerAccount: { limit: 8, windowMs: 15 * 60_000 },

  /**
   * Admin 2FA. Deliberately tight: reaching this endpoint at all means the
   * password is already known, so it is the last barrier standing.
   */
  admin2faPerIp: { limit: 10, windowMs: 15 * 60_000 },
  admin2faPerAccount: { limit: 6, windowMs: 15 * 60_000 },

  /** Password-reset mail. Stops mail-bombing a known admin address. */
  adminForgotPerIp: { limit: 5, windowMs: 60 * 60_000 },
  adminForgotPerEmail: { limit: 3, windowMs: 60 * 60_000 },

  /**
   * Token-bearing endpoints: accepting an invite, completing a reset, and
   * confirming 2FA enrolment.
   *
   * The tokens themselves are 256-bit, so guessing is not the concern.
   * These matter because each one runs bcrypt at cost 12 — deliberately
   * expensive — so an unmetered endpoint that hashes on every request is a
   * cheap way to burn server CPU. `confirm-2fa` additionally verifies a
   * 6-digit TOTP code with no per-account counter of its own, which is the
   * same shape of gap that was fixed on login and verify-2fa.
   */
  adminTokenEndpointPerIp: { limit: 10, windowMs: 15 * 60_000 },

  /** Checkout submissions per session. Backstop against order spam. */
  checkoutPerSession: { limit: 20, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Sliding-window log.
 *
 * ZSET member = a unique attempt id, score = timestamp. Old entries are
 * trimmed, the survivors counted, and the new attempt recorded only if
 * there is room — all inside one Lua invocation, so the check and the
 * write cannot interleave with another container's.
 *
 * Returns {admitted, count, retryAtMs}.
 */
const SLIDING_WINDOW_LUA = `
local key      = KEYS[1]
local now      = tonumber(ARGV[1])
local window   = tonumber(ARGV[2])
local limit    = tonumber(ARGV[3])
local member   = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAt = now + window
  if oldest[2] then retryAt = tonumber(oldest[2]) + window end
  return {0, count, retryAt}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, count + 1, 0}
`;

async function upstash(command: unknown[]): Promise<unknown> {
  const res = await fetch(REST_URL as string, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Upstash responded ${res.status}`);
  }

  const body = (await res.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(`Upstash error: ${body.error}`);
  return body.result;
}

// ---------------------------------------------------------------------------
// Development fallback: same semantics, per-process only.
// ---------------------------------------------------------------------------

const localWindows = new Map<string, number[]>();

function localCheck(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const cutoff = now - rule.windowMs;
  const hits = (localWindows.get(key) ?? []).filter((t) => t > cutoff);

  if (hits.length >= rule.limit) {
    localWindows.set(key, hits);
    const retryAt = hits[0] + rule.windowMs;
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)),
    };
  }

  hits.push(now);
  localWindows.set(key, hits);

  // Opportunistic sweep so a long-lived dev server doesn't grow unbounded.
  if (localWindows.size > 5_000) {
    for (const [k, v] of localWindows) {
      if (!v.some((t) => t > cutoff)) localWindows.delete(k);
    }
  }

  return {
    ok: true,
    remaining: rule.limit - hits.length,
    retryAfterSeconds: 0,
  };
}

/**
 * Records an attempt against `key` and reports whether it is permitted.
 *
 * `key` should identify the actor for one specific endpoint, e.g.
 * `otp-verify:ip:1.2.3.4`. Use `hashIdentifier` for anything containing an
 * email address or username so personal data never lands in Redis.
 */
export async function checkRateLimit(
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  if (!IS_CONFIGURED) {
    if (IS_PRODUCTION) {
      // Fail closed. An unmetered auth endpoint in production is a worse
      // outcome than a rejected request.
      return { ok: false, remaining: 0, retryAfterSeconds: 60 };
    }
    return localCheck(key, rule);
  }

  const namespaced = `rl:${key}`;
  const member = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

  // One retry, because a single dropped connection shouldn't lock anyone
  // out — but no more than one, because a sustained Redis outage must not
  // become a way to stall the auth endpoints indefinitely.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = (await upstash([
        "EVAL",
        SLIDING_WINDOW_LUA,
        "1",
        namespaced,
        String(Date.now()),
        String(rule.windowMs),
        String(rule.limit),
        member,
      ])) as [number, number, number];

      const [admitted, count, retryAtMs] = raw.map(Number);

      if (admitted === 1) {
        return {
          ok: true,
          remaining: Math.max(0, rule.limit - count),
          retryAfterSeconds: 0,
        };
      }

      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((retryAtMs - Date.now()) / 1000),
        ),
      };
    } catch (error) {
      if (attempt === 1) {
        console.error("[rateLimit] Upstash unavailable:", error);
        if (IS_PRODUCTION) {
          return { ok: false, remaining: 0, retryAfterSeconds: 30 };
        }
        return localCheck(key, rule);
      }
    }
  }

  return { ok: false, remaining: 0, retryAfterSeconds: 30 };
}

/**
 * Checks several rules at once and returns the first rejection.
 *
 * Note that every rule is evaluated (not short-circuited), so an attacker
 * cannot avoid being counted against the per-IP limit by tripping the
 * per-account one first.
 */
export async function checkRateLimits(
  checks: Array<{ key: string; rule: RateLimitRule }>,
): Promise<RateLimitResult> {
  const results = await Promise.all(
    checks.map(({ key, rule }) => checkRateLimit(key, rule)),
  );
  const rejected = results.find((r) => !r.ok);
  return rejected ?? results[0] ?? { ok: true, remaining: 0, retryAfterSeconds: 0 };
}

/**
 * Stable, non-reversible key fragment for an email address or username.
 * Lets us rate-limit per account without storing the account in Redis.
 */
export function hashIdentifier(value: string): string {
  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

/**
 * Best-effort client IP.
 *
 * On Vercel `x-forwarded-for` is written by the platform edge, and the
 * left-most entry is the real client — upstream values a client tries to
 * inject are appended after it, not before. `x-real-ip` is set by the same
 * layer and is preferred where present. If this app is ever deployed
 * behind a different proxy, revisit this: on an untrusted path these
 * headers are attacker-controlled and the per-IP limits become bypassable.
 */
export function getClientIp(req: Request): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return "unknown";
}

/** Standard 429 with a Retry-After header. */
export function rateLimitResponse(
  result: RateLimitResult,
  message = "Too many attempts. Please try again later.",
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(result.retryAfterSeconds || 60),
    },
  });
}
