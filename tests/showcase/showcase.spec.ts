import { test, expect, type Page } from "@playwright/test";

async function closeGuide(page: Page) {
  const coachmark = page.getByTestId("tour-coachmark");
  if (await coachmark.isVisible().catch(() => false)) {
    await coachmark.getByRole("button", { name: "Exit guided walkthrough" }).click();
  }
}

async function resetDemoWorkspace(page: Page) {
  const response = await page.request.post("/api/demo/reset", {
    data: { confirmed: true },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/dashboard");
  await page.waitForURL("**/dashboard**");
}

async function selectPersona(page: Page, role: string) {
  // The guided checkpoint can leave the page scrolled to its target content.
  // Bring the persistent persona control into view before choosing a role.
  await page.getByTestId("demo-role-bar").scrollIntoViewIfNeeded();
  const select = page.getByTestId("demo-role-select");
  if (await select.isVisible().catch(() => false)) {
    await select.selectOption(role);
  } else {
    await page.getByTestId(`demo-role-${role}`).click();
  }
  await expect(page.getByTestId(`demo-role-${role}`)).toHaveAttribute("aria-pressed", "true").catch(() => undefined);
}

async function openProjectSection(page: Page, label: "Plan" | "Delivery") {
  const routes = { Plan: "/plan", Delivery: "/board" } as const;
  const select = page.getByRole("combobox", { name: "Project section" });
  if (await select.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) {
    await Promise.all([
      page.waitForURL(`**${routes[label]}`),
      select.selectOption({ label }),
    ]);
    return;
  }
  const tab = page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: label });
  await tab.waitFor({ state: "visible", timeout: 10_000 });
  await tab.click();
}

async function reloadAfterDecision(page: Page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    if (!(await page.getByTestId("app-error").isVisible().catch(() => false))) return;
    await page.getByRole("button", { name: "Retry" }).click().catch(() => undefined);
    await page.waitForTimeout(1000);
  }
  await expect(page.getByTestId("app-error")).toBeHidden();
}

test("public demo entry and dependency health are available", async ({ page, request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect((await health.json()).status).toBe("healthy");

  const buildMetadata = await request.get("/api/build-metadata");
  expect(buildMetadata.status()).toBe(200);
  expect((await buildMetadata.json()).schemaVersion).toBe("1.0");

  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Disallow: /demo");

  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Explore self-guided demo" }),
  ).toHaveAttribute("href", "/demo?tour=self-guided");
  await expect(
    page.getByRole("link", { name: "Take the 5-minute technical tour" }),
  ).toHaveAttribute("href", "/demo?checkpoint=ai-evidence");

  await page.goto("/demo?checkpoint=portfolio-health");
  await page.waitForURL("**/dashboard**");
  await expect(page.getByTestId("demo-role-bar")).toBeVisible();
  await expect(page.getByText("Patient Onboarding Portal", { exact: true })).toBeVisible();
  await closeGuide(page);
});

test("hosted worker completes generate, approve, and materialize", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/demo?checkpoint=portfolio-health");
  await page.waitForURL("**/dashboard**");
  await closeGuide(page);
  await resetDemoWorkspace(page);

  await selectPersona(page, "solutions_engineer");
  await page.goto("/projects");
  await page.getByRole("link", { name: "Patient Onboarding Portal", exact: true }).click();
  await openProjectSection(page, "Plan");
  await page.getByRole("button", { name: "Generate implementation plan" }).click();
  await expect(page.getByText(/Plan v\d/)).toBeVisible({ timeout: 75_000 });
  await expect(page.getByText("awaiting review", { exact: false })).toBeVisible();

  await selectPersona(page, "implementation_manager");
  await page.goto("/approvals");
  const card = page.locator("div.card", { hasText: "Patient Onboarding Portal" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Approve", exact: true }).first().click();
  await expect(page.getByText("Approved. The delivery view will update shortly.", { exact: true })).toBeVisible({ timeout: 10_000 });
  await reloadAfterDecision(page);
  await expect(page.getByText("approved", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await page.goto("/projects");
  await page.getByRole("link", { name: "Patient Onboarding Portal", exact: true }).click();
  await openProjectSection(page, "Delivery");
  await expect(page.getByText("Run kickoff workshop").first()).toBeVisible({ timeout: 30_000 });
});

test("customer persona is limited to its assigned project", async ({ page }) => {
  await page.goto("/demo?checkpoint=portfolio-health");
  await page.waitForURL("**/dashboard**");
  await closeGuide(page);
  await selectPersona(page, "customer_stakeholder");
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: "Order Intake Automation", exact: true })).toBeVisible();
  await expect(page.getByText("Claims Status Tracker", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Patient Onboarding Portal", { exact: true })).toHaveCount(0);
});
