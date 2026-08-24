import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // An unrelated lockfile may exist above the repo in a developer's home
  // directory. Keep Turbopack's file tracing and module resolution scoped to
  // this project instead of relying on automatic root detection.
  turbopack: {
    root: process.cwd(),
  },
  // Keep framework chrome out of demo screenshots and interactive controls.
  // Compile/runtime errors still surface in the terminal and Next.js overlay.
  devIndicators: false,
  // Local production runs and Vercel use the normal Next.js output. Container
  // builds opt into the smaller standalone bundle in the Dockerfile.
  output: process.env.WORKBENCH_STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
