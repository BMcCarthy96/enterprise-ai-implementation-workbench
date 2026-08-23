import { defineConfig } from "@playwright/test";

const baseURL = process.env.SHOWCASE_BASE_URL ?? process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error("SHOWCASE_BASE_URL or E2E_BASE_URL must point at the deployed showcase");
}

export default defineConfig({
  testDir: "./tests/showcase",
  timeout: 90_000,
  retries: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
