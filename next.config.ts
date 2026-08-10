import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // An unrelated lockfile may exist above the repo in a developer's home
  // directory. Keep Turbopack's file tracing and module resolution scoped to
  // this project instead of relying on automatic root detection.
  turbopack: {
    root: process.cwd(),
  },
  // Keep the dev overlay out of the bottom-left corner, where it would sit on
  // top of the sidebar's sign-out control (and intercept its clicks in e2e).
  devIndicators: {
    position: "bottom-right",
  },
  // Emit a standalone server bundle for container/App Runner deployment.
  output: "standalone",
};

export default nextConfig;
