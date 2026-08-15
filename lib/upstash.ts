/**
 * Low-level access to Upstash Redis over its REST API.
 *
 * Extracted from `lib/rateLimit.ts` so that more than one subsystem can
 * share the connection details and the fail-closed policy. Two use it
 * today: the rate limiter (`lib/rateLimit.ts`) and the checkout
 * concurrency gate (`lib/checkoutGate.ts`).
 *
 * Why REST and not a Redis client library: the REST endpoint is a plain
 * fetch, so this adds no dependency, no cold-start cost, and works
 * unchanged on both the Node and Edge runtimes.
 *
 * Required environment variables:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * If they are missing in production, callers are expected to FAIL CLOSED —
 * see each caller for what that means in its own context. In development
 * each caller falls back to an in-process equivalent so `next dev` works
 * with no extra setup.
 */

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export const IS_PRODUCTION = process.env.NODE_ENV === "production";
export const UPSTASH_CONFIGURED = Boolean(REST_URL && REST_TOKEN);

if (!UPSTASH_CONFIGURED && IS_PRODUCTION) {
  console.error(
    "[upstash] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set. " +
      "Rate-limited endpoints will reject all requests, and checkout will be " +
      "unavailable, until they are configured.",
  );
}

/**
 * Sends one Redis command as a JSON array, e.g. `["ZCARD", "mykey"]`.
 *
 * Throws on a non-2xx response or on a Redis-level error, so callers can
 * treat any rejection as "Redis is unavailable" without inspecting it.
 */
export async function upstashCommand(command: unknown[]): Promise<unknown> {
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
