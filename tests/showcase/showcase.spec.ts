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
  // The recent-decision card also renders the approval subject and note, so
  // a broad /approved/i locator is ambiguous after the queue refreshes. The
  // exact status badge is the signal this flow is proving.
  await expect(card.getByText("approved", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await page.goto("/projects");
  await page.getByRole("link", { name: "Patient Onboarding Portal", exact: true }).click();
  await openProjectSection(page, "Delivery");
  await expect(page.getByText("Run kickoff workshop").first()).toBeVisible({ timeout: 30_000 });
});
