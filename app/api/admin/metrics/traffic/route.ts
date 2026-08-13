import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/adminGuard";
import { getTraffic } from "@/lib/vercelAnalytics";

/**
 * Page views and visitors, proxied from Vercel Web Analytics.
 *
 * The proxy is the point. The browser never sees the Vercel access token —
 * a credential scoped to the whole account, not just to reading analytics —
 * and the owner check runs on our side before any call goes out, so this
 * endpoint cannot be used as an unauthenticated relay to somebody else's
 * Vercel quota.
 *
 * Owner-only, matching the vitals endpoint and the page that renders both.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mirrors the ranges offered on the vitals endpoint. */
const ALLOWED_DAYS = [1, 7, 30] as const;
const DEFAULT_DAYS = 7;

export async function GET(req: NextRequest) {
  const owner = await requireOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rawDays = Number(req.nextUrl.searchParams.get("days"));
  const days = (ALLOWED_DAYS as readonly number[]).includes(rawDays)
    ? rawDays
    : DEFAULT_DAYS;

  // `getTraffic` never throws — an unconfigured or unreachable Vercel comes
  // back as a described state, not an exception — so this is deliberately
  // a 200 either way. The panel renders the explanation; a 500 would make
  // "you haven't set the token yet" look like the admin panel is broken.
  const traffic = await getTraffic(days);

  return NextResponse.json(traffic);
}
