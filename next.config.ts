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

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
