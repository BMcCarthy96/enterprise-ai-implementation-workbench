import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const baseUrl = process.env.EVIDENCE_BASE_URL ?? "http://localhost:3000";
const outputDir = join(process.cwd(), "artifacts", "evidence");
mkdirSync(outputDir, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(outputDir, "01-landing.png"), fullPage: true });

  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(process.env.EVIDENCE_EMAIL ?? "manager@northwind.dev");
  await page.getByLabel("Password").fill(process.env.EVIDENCE_PASSWORD ?? "demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  await page.screenshot({ path: join(outputDir, "02-dashboard.png"), fullPage: true });

  await page.goto(`${baseUrl}/insights`, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(outputDir, "03-ai-quality.png"), fullPage: true });
  await page.goto(`${baseUrl}/ai-runs`, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(outputDir, "04-ai-runs.png"), fullPage: true });
  await page.goto(`${baseUrl}/projects`, { waitUntil: "networkidle" });
  const projectHref = await page
    .getByRole("link", { name: "Order Intake Automation" })
    .getAttribute("href");
  if (!projectHref) throw new Error("Seeded project link is missing");
  const projectUrl = new URL(projectHref, baseUrl).toString();
  await page.goto(projectUrl, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(outputDir, "05-project-overview.png"), fullPage: true });
  for (const [suffix, fileName] of [
    ["documents", "06-grounded-documents.png"],
    ["plan", "07-grounded-plan-and-diff.png"],
    ["board", "08-delivery-board.png"],
    ["timeline", "09-customer-timeline.png"],
  ] as const) {
    await page.goto(`${projectUrl}/${suffix}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: join(outputDir, fileName), fullPage: true });
  }
  await page.goto(`${baseUrl}/approvals`, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(outputDir, "10-approval-queue.png"), fullPage: true });
  await browser.close();
  console.log(`Evidence screenshots written to ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
