// next.config.ts (or next.config.js)
// If you're using JS, just remove the type import.

import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  async headers() {
    // Build CSP with a dev-friendly script-src
    const scriptSrc = [
      "'self'",
      "'unsafe-inline'",
      // allow eval only in dev for Next/Turbopack
      ...(isDev ? ["'unsafe-eval'"] : []),
      "https:",
    ].join(" ");

    const csp = [
      "default-src 'self'",
      // images (incl. external brand logos) + data/blob URLs
      "img-src 'self' https: data: blob:",
      // inline styles are typical in Next/Tailwind
      "style-src 'self' 'unsafe-inline' https:",
      // scripts
      `script-src ${scriptSrc}`,
      // RSC streaming, Vercel vitals, Blob fetches (if any future use)
      "connect-src 'self' https://vitals.vercel-insights.com https://*.vercel-storage.com https://belief-blueprint.vercel.app",
      // fonts
      "font-src 'self' https: data:",
      // clickjacking protection via CSP
      "frame-ancestors 'self'",
      // extra hardening
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          // Security headers
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // HSTS (only effective on HTTPS, which Vercel uses)
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // COOP/CORP help isolate browsing context (prevents some XS-Leaks)
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-site" },
          // Lock down powerful features
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
          // Your CSP
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
