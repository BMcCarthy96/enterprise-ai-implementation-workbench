import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // An unrelated lockfile may exist above the repo in a developer's home
  // directory. Keep Turbopack's file tracing and module resolution scoped to
  // this project instead of relying on automatic root detection.
  turbopack: {
    root: process.cwd(),
  },
  // Keep framework chrome out of recruiter screenshots and interactive controls.
  // Compile/runtime errors still surface in the terminal and Next.js overlay.
  devIndicators: false,
  // Emit a standalone server bundle for container/App Runner deployment.
  output: "standalone",
};

export default nextConfig;
