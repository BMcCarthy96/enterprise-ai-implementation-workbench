import { chromium, type Page } from "@playwright/test";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const baseUrl = process.env.EVIDENCE_BASE_URL ?? "http://localhost:3000";
const outputDir = join(process.cwd(), "artifacts", "evidence");
const videoDir = join(outputDir, "video-work");
mkdirSync(videoDir, { recursive: true });

const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function switchDemoRole(page: Page, role: string) {
  const coachmark = page.getByTestId("tour-coachmark");
  if (await coachmark.isVisible().catch(() => false)) {
    await coachmark
      .getByRole("button", { name: "Exit guided walkthrough" })
      .click();
  }
  const panel = page.getByTestId("recruiter-mode-panel");
  if ((await panel.getAttribute("aria-hidden")) === "false") {
    await panel
      .getByRole("button", { name: "Minimize guided walkthrough" })
      .click();
    await page.getByTestId("tour-open").waitFor({ state: "visible" });
  }
  const target = page.getByTestId(`demo-role-${role}`);
  if ((await target.getAttribute("aria-pressed")) === "true") return;
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith("/api/demo/role") &&
        candidate.request().method() === "POST",
    ),
    target.click(),
  ]);
  if (!response.ok()) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error ?? `Demo role switch failed with ${response.status()}`,
    );
  }
  await page.waitForFunction(
    (targetRole) =>
      document
        .querySelector(`[data-testid="demo-role-${targetRole}"]`)
        ?.getAttribute("aria-pressed") === "true",
    role,
  );
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(30_000);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await pause(2500);
    const launchResponsePromise = page.waitForResponse("**/api/demo/session");
    await page.getByRole("button", { name: "Start 90-second tour" }).click();
    const launchResponse = await launchResponsePromise;
    if (!launchResponse.ok()) {
      const body = (await launchResponse.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(
        body?.error ?? `Demo launch failed with ${launchResponse.status()}`,
      );
    }
    await page.waitForURL("**/dashboard");
    await page.locator("#portfolio-health-heading").waitFor();
    const coachmark = page.getByTestId("tour-coachmark");
    await coachmark.waitFor({ state: "visible" });
    await page.getByTestId("tour-spotlight").waitFor({ state: "visible" });
    await pause(3000);
    await coachmark.getByTestId("tour-coachmark-next").click();
    await page.waitForURL("**/plan");
    await pause(2500);
    await coachmark.getByTestId("tour-coachmark-next").click();
    await page.getByRole("heading", { name: "AI evidence packet" }).waitFor();
    await pause(3500);
    await coachmark.getByTestId("tour-coachmark-next").click();
    await page.waitForURL("**/approvals");
    await pause(3000);
    await coachmark.getByRole("button", { name: "All steps" }).click();
    await page.getByTestId("recruiter-mode-panel").waitFor({ state: "visible" });
    await pause(2000);
    await page.getByRole("button", { name: "Minimize guided walkthrough" }).click();

    await switchDemoRole(page, "customer_stakeholder");
    await pause(2000);
    await page.goto(`${baseUrl}/projects`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Order Intake Automation" }).click();
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("link", { name: "Timeline" })
      .click();
    await pause(3000);

    await page.goto(`${baseUrl}/dashboard`, { waitUntil: "networkidle" });
    await switchDemoRole(page, "org_admin");
    await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
    await pause(3000);

    const video = page.video();
    await context.close();
    const videoPath = await video?.path();
    if (!videoPath) throw new Error("Playwright did not produce a video");
    const destination = join(outputDir, "enterprise-ai-workbench-demo.webm");
    renameSync(videoPath, destination);
    console.log(`Recruiter demo video written to ${destination}`);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
