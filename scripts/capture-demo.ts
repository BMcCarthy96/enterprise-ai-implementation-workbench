import { chromium } from "@playwright/test";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const baseUrl = process.env.EVIDENCE_BASE_URL ?? "http://localhost:3000";
const outputDir = join(process.cwd(), "artifacts", "evidence");
const videoDir = join(outputDir, "video-work");
mkdirSync(videoDir, { recursive: true });

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await pause(3000);
  await page.getByRole("button", { name: /Launch interactive demo/i }).click();
  await page.waitForURL("**/dashboard");
  await pause(4000);
  await page.goto(`${baseUrl}/insights`, { waitUntil: "networkidle" });
  await pause(5000);
  await page.goto(`${baseUrl}/ai-runs`, { waitUntil: "networkidle" });
  await pause(5000);
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(process.env.EVIDENCE_EMAIL ?? "manager@northwind.dev");
  await page.getByLabel("Password").fill(process.env.EVIDENCE_PASSWORD ?? "demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  await pause(4000);
  const video = page.video();
  await context.close();
  await browser.close();
  const videoPath = await video?.path();
  if (!videoPath) throw new Error("Playwright did not produce a video");
  const destination = join(outputDir, "enterprise-ai-workbench-demo.webm");
  renameSync(videoPath, destination);
  console.log(`Recruiter demo video written to ${destination}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
