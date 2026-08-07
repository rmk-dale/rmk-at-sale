import type { NextConfig } from "next";

/**
 * Baseline response headers.
 *
 * `frame-ancestors 'none'` matters most for the admin panel: without it the
 * dashboard can be framed by another origin, and a clickjacked admin can be
 * made to cancel orders or disable accounts. HSTS and the referrer policy
 * are cheap defaults worth having everywhere.
 *
 * A full Content-Security-Policy is deliberately not set here — Next's
 * inline bootstrap scripts need either a nonce or 'unsafe-inline', so
 * adding one without testing tends to break the app. `frame-ancestors` is
 * the part that carries real weight and is safe to set on its own.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

/**
 * Blanket `no-store` for every authenticated or per-user endpoint.
 *
 * Public storefront reads set their own `public, s-maxage=...` so a CDN can
 * hold them (see lib/httpCache.ts). That makes the *absence* of a cache
 * header on a sensitive route dangerous in a way it wasn't before: a
 * shared cache that stores one admin's order list, or a checkout response,
 * can serve it to somebody else.
 *
 * Rather than depend on every current and future route handler remembering
 * to opt out, the whole authenticated surface is denied caching here by
 * path. Route handlers still set their own matching header — this is the
 * backstop, not the only line of defence.
 */
const noStoreApiPaths = [
  "/api/admin/:path*",
  "/api/auth/:path*",
  "/api/checkout",
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...noStoreApiPaths.map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      })),
    ];
  },
};

export default nextConfig;
