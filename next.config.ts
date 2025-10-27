import type { NextConfig } from "next";

/**
 * Next.js configuration for Belief Blueprint GPT
 * - Ensures Puppeteer + Chromium runtime binaries are included
 *   in the serverless build on Vercel.
 * - Compatible with Next.js 15+ (uses `serverExternalPackages`)
 */
const nextConfig: NextConfig = {
  // Include these server packages so their binaries (like Chromium) are bundled correctly
  serverExternalPackages: [
    "@sparticuz/chromium",
    "puppeteer-core",
  ],

  // Add any other Next.js config options below as needed
  reactStrictMode: true,
  swcMinify: true,
};

export default nextConfig;
