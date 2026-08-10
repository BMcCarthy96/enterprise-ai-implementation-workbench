import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/unit/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      // Core policy/evidence libraries are the coverage contract. Provider
      // adapters, database orchestration, and cloud-only edges are exercised
      // by integration/e2e lanes and are intentionally not counted here.
      include: [
        "src/lib/auth/rbac.ts",
        "src/lib/ai/evidence.ts",
        "src/lib/ai/planDiff.ts",
        "src/lib/ai/planSchema.ts",
        "src/lib/ai/redaction.ts",
        "src/lib/sla.ts",
        "src/server/services/timeline.ts",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
});
