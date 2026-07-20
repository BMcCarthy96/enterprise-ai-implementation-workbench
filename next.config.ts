import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the dev overlay out of the bottom-left corner, where it would sit on
  // top of the sidebar's sign-out control (and intercept its clicks in e2e).
  devIndicators: {
    position: "bottom-right",
  },
  // Emit a standalone server bundle for container/App Runner deployment.
  output: "standalone",
};

export default nextConfig;
