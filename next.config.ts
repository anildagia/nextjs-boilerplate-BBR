import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
    experimental: {
    ...(module.exports?.experimental || {}),
    serverComponentsExternalPackages: [
      ...((module.exports?.experimental?.serverComponentsExternalPackages) || []),
      '@sparticuz/chromium',
      'puppeteer-core',
    ],
  },
};

export default nextConfig;
