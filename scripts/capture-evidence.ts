import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const baseUrl = process.env.EVIDENCE_BASE_URL ?? "http://localhost:3000";
const outputDir = join(process.cwd(), "artifacts", "evidence");
mkdirSync(outputDir, { recursive: true });

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
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(30_000);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.screenshot({
      path: join(outputDir, "01-landing.png"),
      fullPage: true,
    });

    await page.goto(`${baseUrl}/proof`, { waitUntil: "networkidle" });
    await page.screenshot({
      path: join(outputDir, "02-proof-hub.png"),
      fullPage: true,
    });
    await page.goto(`${baseUrl}/proof/case-study`, {
      waitUntil: "networkidle",
    });
    await page.screenshot({
      path: join(outputDir, "03-case-study.png"),
      fullPage: true,
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });
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
    await page.getByTestId("tour-coachmark").waitFor({ state: "visible" });
    await page.getByTestId("tour-spotlight").waitFor({ state: "visible" });
    await page.screenshot({
      path: join(outputDir, "04-dashboard-recruiter-mode.png"),
      fullPage: false,
    });
    await page
      .getByTestId("tour-coachmark")
      .getByRole("button", { name: "Exit guided walkthrough" })
      .click();

    await page.goto(`${baseUrl}/ai-runs`, { waitUntil: "networkidle" });
    await page.screenshot({
      path: join(outputDir, "05-ai-runs.png"),
      fullPage: true,
    });
    await page
      .getByRole("link", { name: /[0-9a-f]{8}/i })
      .first()
      .click();
    await page.getByRole("heading", { name: "AI evidence packet" }).waitFor();
    await page.screenshot({
      path: join(outputDir, "06-ai-evidence-packet.png"),
      fullPage: true,
    });

    await page.goto(`${baseUrl}/projects`, { waitUntil: "networkidle" });
    const projectHref = await page
      .getByRole("link", { name: "Order Intake Automation" })
      .getAttribute("href");
    if (!projectHref) throw new Error("Seeded project link is missing");
    const projectUrl = new URL(projectHref, baseUrl).toString();
    await page.goto(projectUrl, { waitUntil: "networkidle" });
    await page.screenshot({
      path: join(outputDir, "07-project-overview.png"),
      fullPage: true,
    });
    for (const [suffix, fileName] of [
      ["documents", "08-grounded-documents.png"],
      ["plan", "09-grounded-plan-and-diff.png"],
      ["board", "10-delivery-board.png"],
    ] as const) {
      await page.goto(`${projectUrl}/${suffix}`, { waitUntil: "networkidle" });
      await page.screenshot({
        path: join(outputDir, fileName),
        fullPage: true,
      });
    }
    await page.goto(`${baseUrl}/approvals`, { waitUntil: "networkidle" });
    await page.screenshot({
      path: join(outputDir, "11-approval-queue.png"),
      fullPage: true,
    });

    await switchDemoRole(page, "customer_stakeholder");
    await page.goto(`${baseUrl}/projects`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Order Intake Automation" }).click();
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("link", { name: "Timeline" })
      .click();
    await page.screenshot({
      path: join(outputDir, "12-customer-safe-timeline.png"),
      fullPage: true,
    });

    await page.goto(`${baseUrl}/dashboard`, { waitUntil: "networkidle" });
    await switchDemoRole(page, "org_admin");
    await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
    await page.screenshot({
      path: join(outputDir, "13-enterprise-settings.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
  console.log(`Evidence screenshots written to ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
