import type { NextConfig } from "next";

/**
 * The Dashboard is the only publicly reachable surface, so it ships restrictive
 * browser security headers. `frame-ancestors 'none'` and `form-action 'self'`
 * matter as much as the session cookie: they keep an authenticated session from
 * being driven by another origin.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Next.js hydration injects inline bootstrap scripts and styles.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "content-security-policy", value: CONTENT_SECURITY_POLICY },
          { key: "referrer-policy", value: "same-origin" },
          { key: "x-content-type-options", value: "nosniff" },
          { key: "x-frame-options", value: "DENY" },
          {
            key: "permissions-policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          { key: "cross-origin-opener-policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;
