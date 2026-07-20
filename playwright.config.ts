import { defineConfig } from "@playwright/test";

/**
 * E2E smoke tests against the dev server with seeded data.
 * Prereqs: docker compose up -d && npm run db:migrate && npm run db:seed.
 * The full async plan-generation flow additionally needs `npm run worker`
 * running; those tests skip themselves when E2E_WORKER=1 is not set.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
