import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* existing config options */
  async headers() {
    return [
      {
        source: "/(.*)", // apply to all routes
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self';",
              "img-src 'self' https: data:;",
              "style-src 'self' 'unsafe-inline' https:;",
              "script-src 'self';",
              "connect-src 'self' https://belief-blueprint.vercel.app;",
            ].join(" "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
