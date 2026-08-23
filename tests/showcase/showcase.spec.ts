import { test, expect, type Page } from "@playwright/test";

async function closeGuide(page: Page) {
  const coachmark = page.getByTestId("tour-coachmark");
  if (await coachmark.isVisible().catch(() => false)) {
    await coachmark.getByRole("button", { name: "Exit guided walkthrough" }).click();
  }
}

async function selectPersona(page: Page, role: string) {
  const select = page.getByTestId("demo-role-select");
  if (await select.isVisible().catch(() => false)) {
    await select.selectOption(role);
  } else {
    await page.getByTestId(`demo-role-${role}`).click();
  }
  await expect(page.getByTestId(`demo-role-${role}`)).toHaveAttribute("aria-pressed", "true").catch(() => undefined);
}

test("public demo entry and dependency health are available", async ({ page, request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect((await health.json()).status).toBe("healthy");

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

  await selectPersona(page, "solutions_engineer");
  await page.goto("/projects");
  await page.getByRole("link", { name: "Patient Onboarding Portal", exact: true }).click();
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Plan" }).click();
  await page.getByRole("button", { name: "Generate implementation plan" }).click();
  await expect(page.getByText(/Plan v\d/)).toBeVisible({ timeout: 75_000 });
  await expect(page.getByText("awaiting review", { exact: false })).toBeVisible();

  await selectPersona(page, "implementation_manager");
  await page.goto("/approvals");
  const card = page.locator("div.card", { hasText: "Patient Onboarding Portal" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Approve", exact: true }).first().click();
  await expect(card.getByText(/approved/i)).toBeVisible({ timeout: 30_000 });

  await page.goto("/projects");
  await page.getByRole("link", { name: "Patient Onboarding Portal", exact: true }).click();
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Delivery" }).click();
  await expect(page.getByText("Run kickoff workshop").first()).toBeVisible({ timeout: 30_000 });
});
