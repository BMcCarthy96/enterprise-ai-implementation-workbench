import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/demo",
        "/ai-runs",
        "/approvals",
        "/audit",
        "/dashboard",
        "/insights",
        "/ops",
        "/projects",
        "/settings",
      ],
    },
  };
}
