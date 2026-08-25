import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    // Linting is run explicitly in CI (npm run lint); do not block `next build` on it here
    // so that `npm run build` and `npm run lint` remain independently diagnosable steps.
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
