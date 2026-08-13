import { ObjectId } from "mongodb";
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
} from "@/lib/rateLimit";
import {
  deviceFromUserAgent,
  getWebVitalsCollection,
  isPlausibleValue,
  isWebVitalName,
  normalizeRoute,
  rateValue,
  type WebVitalDoc,
} from "@/lib/models/webVital";

/**
 * Collector for real-user performance samples.
 *
 * This is the only write endpoint in the app that takes no credentials of
 * any kind, and it cannot be otherwise: the whole point is to measure
 * anonymous visitors before they ever sign in. Everything below follows
 * from that.
 *
 * The threat is not someone stealing data — there is none here to steal —
 * it is someone using an open write path to fill the Atlas cluster that
 * orders live in, or to poison the numbers the team makes decisions from.
 * So, in order:
 *
 *   1. The body is read as text with a hard size cap *before* it is
 *      parsed, so a 50 MB payload is dropped without being materialised
 *      into objects.
 *   2. The batch is capped at MAX_BATCH entries. One beacon per page view
 *      carries five metrics; anything much larger is not a browser.
 *   3. Every field is validated against the allowlists in the model.
 *      `rating` is recomputed and `device` is read from the User-Agent
 *      header rather than the body, so neither can be dictated by the
 *      caller.
 *   4. Per-IP rate limiting, sized in RATE_LIMITS.vitalsPerIp.
 *
 * It always answers 204 with an empty body, even when it discards
 * everything. A beacon has no error handling to speak of — `sendBeacon`
 * cannot read a response at all — so a status code would be talking to
 * nobody, while a detailed error would just tell an attacker which of the
 * checks above they tripped.
 */

// Needs the MongoDB driver, which is not available on the Edge runtime.
export const runtime = "nodejs";

/** Measurements are per-request by definition; never serve a cached one. */
export const dynamic = "force-dynamic";

/**
 * Roughly 2 KB. A five-metric beacon is a few hundred bytes, so this is
 * ~4x headroom over the largest honest payload.
 */
const MAX_BODY_BYTES = 2048;

/** Five Core Web Vitals, plus room for a re-report or two. */
const MAX_BATCH = 8;

/** 204 No Content. The only response this endpoint ever gives. */
function accepted(): Response {
  return new Response(null, { status: 204 });
}

export async function POST(req: Request) {
  const limit = await checkRateLimit(
    `vitals:ip:${getClientIp(req)}`,
    RATE_LIMITS.vitalsPerIp,
  );
  // Deliberately not a 429. A rejected beacon has nothing useful to do
  // with the refusal, and telling a flooder they have been throttled is
  // more information than they need.
  if (!limit.ok) return accepted();

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return accepted();
  }

  // Byte length, not string length — a multi-byte payload is bigger on the
  // wire than `raw.length` suggests.
  if (new Blob([raw]).size > MAX_BODY_BYTES) return accepted();

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return accepted();
  }

  if (typeof payload !== "object" || payload === null) return accepted();

  const { route, metrics } = payload as {
    route?: unknown;
    metrics?: unknown;
  };

  if (!Array.isArray(metrics) || metrics.length === 0) return accepted();

  const at = new Date();
  const normalizedRoute = normalizeRoute(route);
  const device = deviceFromUserAgent(req.headers.get("user-agent"));

  const docs: WebVitalDoc[] = [];

  for (const entry of metrics.slice(0, MAX_BATCH)) {
    if (typeof entry !== "object" || entry === null) continue;

    const { name, value, navigationType } = entry as {
      name?: unknown;
      value?: unknown;
      navigationType?: unknown;
    };

    if (!isWebVitalName(name)) continue;
    if (!isPlausibleValue(name, value)) continue;

    docs.push({
      _id: new ObjectId(),
      at,
      name,
      value: value as number,
      // Recomputed, never trusted: a forged `rating: "good"` on a 12-second
      // LCP would otherwise make the dashboard report the opposite of the
      // truth.
      rating: rateValue(name, value as number),
      route: normalizedRoute,
      // Free-form but bounded. Useful for separating a cold navigation
      // from a back-forward-cache restore, which have very different
      // numbers; truncated because it arrives from the client.
      navigationType:
        typeof navigationType === "string" && navigationType.length <= 32
          ? navigationType
          : undefined,
      device,
    });
  }

  if (docs.length === 0) return accepted();

  try {
    const collection = await getWebVitalsCollection();
    // Unordered so one rejected document doesn't discard the rest of the
    // batch behind it.
    await collection.insertMany(docs, { ordered: false });
  } catch (error) {
    // Quiet by design, and the opposite of how a failed audit write is
    // handled. A missing audit entry is evidence lost forever; a missing
    // performance sample is one dot on a chart drawn from thousands. If
    // Atlas is unhappy, the last thing it needs is this endpoint filling
    // the logs on every page view.
    console.warn("[vitals] Failed to record samples:", error);
  }

  return accepted();
}
