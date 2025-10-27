import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const csp = [
      "default-src 'self'",
      // Next and your images (incl. Vercel Blob thumbnails) + data URLs
      "img-src 'self' https: data: blob:",
      // Inline styles are common with Tailwind/Next
      "style-src 'self' 'unsafe-inline' https:",
      // Next may inject tiny inline bootstrap; dev may use eval; allow https cdn
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      // Streaming RSC, Vercel vitals, and your blob domain fetches
      "connect-src 'self' https://belief-blueprint.vercel.app https://vitals.vercel-insights.com https://*.vercel-storage.com",
      // Fonts if you add any
      "font-src 'self' https: data:",
      // Disallow being framed by other sites
      "frame-ancestors 'self'",
      // Extra hardening
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
