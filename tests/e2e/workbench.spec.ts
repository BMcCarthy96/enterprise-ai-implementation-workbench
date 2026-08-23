import { test, expect, type Page } from "@playwright/test";

/** Sign in through the real login form. */
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

async function closeRecruiterGuide(page: Page) {
  const coachmark = page.getByTestId("tour-coachmark");
  await coachmark.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  if (await coachmark.isVisible().catch(() => false)) {
    await coachmark
      .getByRole("button", { name: "Exit guided walkthrough" })
      .click();
    await expect(page.getByTestId("tour-open")).toBeVisible();
    return;
  }
  const panel = page.getByTestId("recruiter-mode-panel");
  if ((await panel.getAttribute("aria-hidden")) === "false") {
    await panel
      .getByRole("button", { name: "Minimize guided walkthrough" })
      .click();
  }
  await expect(panel).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByTestId("tour-open")).toBeVisible();
}

async function startRoleWalkthrough(page: Page) {
  const prompt = page.getByTestId("role-tour-prompt");
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await prompt.getByRole("button", { name: "Start this walkthrough" }).click();
}

async function expectNoInternalOverflow(page: Page, testId: string) {
  expect(
    await page.getByTestId(testId).evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
}

async function walkCoachmarks(page: Page, titles: string[]) {
  const coachmark = page.getByTestId("tour-coachmark");
  for (const [index, title] of titles.entries()) {
    await expect(
      coachmark.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("tour-spotlight")).toBeVisible();
    await expect(
      coachmark.getByRole("heading", { name: "This item is no longer here" }),
    ).toHaveCount(0);
    await coachmark.getByTestId("tour-coachmark-next").click();
    if (index === titles.length - 1) {
      await expect(page.getByTestId("tour-open")).toBeVisible();
    }
  }
}

test.describe("interactive guided demo", () => {
  test("opens a demo from the sign-in page without credentials", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Interactive demo", { exact: true })).toBeVisible();
    await expect(page.getByText(/recruiter-ready/i)).toHaveCount(0);

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Try the interactive demo" })).toBeVisible();
    await expect(page.getByText("No account or password is needed.", { exact: false })).toBeVisible();

    const launch = page.waitForResponse("**/api/demo/session");
    await page.getByRole("button", { name: "Open demo workspace" }).click();
    await expect((await launch).ok()).toBe(true);
    await page.waitForURL("**/dashboard");
    await expect(page.getByTestId("demo-role-bar")).toBeVisible();
  });

  test("launches with delivery, governance, AI, and operations evidence", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start 90-second tour" }).click();
    await page.waitForURL("**/dashboard");
    await expect(page.getByTestId("tour-coachmark")).toBeVisible();
    await closeRecruiterGuide(page);

    await expect(page.getByRole("link", { name: "3 Active projects" })).toBeVisible();
    await expect(page.getByRole("link", { name: "2 Pending approvals" })).toBeVisible();
    await expect(page.getByRole("link", { name: "6 Open tasks" })).toBeVisible();
    await expect(page.getByRole("link", { name: "1 Failed jobs" })).toBeVisible();
    await expect(page.getByText("1 task blocked 8d+", { exact: true })).toBeVisible();
    await expect(page.getByText("Patient Onboarding Portal", { exact: true })).toBeVisible();

    await page.goto("/approvals");
    await expect(page.getByText("Order Intake Automation — UAT Readiness")).toBeVisible();
    await expect(page.getByText("Implementation plan v1")).toBeVisible();

    await page.goto("/ai-runs");
    await expect(page.getByRole("table").getByText("repaired", { exact: true })).toBeVisible();
    await expect(page.getByText("Not priced", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: /[0-9a-f]{8}/i }).first().click();
    await expect(page.getByRole("heading", { name: "AI evidence packet" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Automated checks" })).toBeVisible();
    await expect(page.getByText("Evidence retention boundary")).toBeVisible();
  });

  test("opens once, advances explicitly, and saves walkthrough progress", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start 90-second tour" }).click();
    await page.waitForURL("**/dashboard");

    const coachmark = page.getByTestId("tour-coachmark");
    await expect(coachmark).toBeVisible();
    await expect(coachmark.getByRole("heading", { name: "Portfolio health" })).toBeVisible();
    await expect(coachmark).not.toContainText(/recruiter/i);
    await expect(page.getByTestId("tour-spotlight")).toBeVisible();
    await expect(page.getByTestId("tour-coachmark-arrow")).toBeVisible();
    await coachmark.getByRole("button", { name: "Exit guided walkthrough" }).click();
    await expect(page.getByTestId("tour-open")).toBeVisible();
    await expect(page.getByTestId("tour-open")).toBeFocused();
    const quota = page.getByTestId("demo-quota");
    await expect(quota.getByText("Isolated demo", { exact: true })).toBeVisible();
    await quota.locator("summary").click();
    await expect(quota.getByText(/Synthetic workspace · expires/)).toBeVisible();
    await page.getByTestId("tour-open").click();
    await expect(coachmark).toBeVisible();
    await coachmark.getByTestId("tour-coachmark-next").click();
    await page.waitForURL("**/plan");
    await expect(coachmark.getByRole("heading", { name: "Plan and source" })).toBeVisible();
    await coachmark.getByRole("button", { name: "All steps" }).click();
    const panel = page.getByTestId("recruiter-mode-panel");
    await expect(panel).toHaveAttribute("aria-hidden", "false");
    await expect(panel.getByText("See how the project works")).toBeVisible();
    await expect(panel).not.toContainText(/recruiter/i);
    await panel.getByRole("button", { name: "Minimize guided walkthrough" }).click();
    await expect(page.getByTestId("tour-open")).toContainText("2/8");
    await page.reload();
    await expect(page.getByTestId("tour-open")).toContainText("2/8");
  });

  test("switches among seeded demo personas while preserving RBAC", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Start 90-second tour" }).click();
    await page.waitForURL("**/dashboard");
    await closeRecruiterGuide(page);
    const bar = page.getByTestId("demo-role-bar");
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId("demo-role-implementation_manager")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("tour-open").click();
    await expect(page.getByTestId("tour-coachmark").getByRole("heading", { name: "Portfolio health" })).toBeVisible();
    await closeRecruiterGuide(page);

    await bar.getByTestId("demo-role-solutions_engineer").click();
    await expect(bar.getByTestId("demo-role-solutions_engineer")).toHaveAttribute("aria-pressed", "true");
    await startRoleWalkthrough(page);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "AI Evidence" })).toHaveCount(0);
    expect((await page.request.get("/api/v1/ai-runs")).status()).toBe(403);
    await expect(page.getByTestId("tour-coachmark").getByRole("heading", { name: "Requirements" })).toBeVisible();
    await expect(page.getByTestId("tour-spotlight")).toBeVisible();
    await closeRecruiterGuide(page);

    await bar.getByTestId("demo-role-customer_stakeholder").click();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Operations" })).toHaveCount(0);
    await startRoleWalkthrough(page);
    await expect(page.getByTestId("tour-coachmark").getByRole("heading", { name: "Project overview" })).toBeVisible();
    await closeRecruiterGuide(page);

    await bar.getByTestId("demo-role-org_admin").click();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" })).toBeVisible();
    await startRoleWalkthrough(page);
    await expect(page.getByTestId("tour-coachmark").getByRole("heading", { name: "Portfolio health" })).toBeVisible();
    await closeRecruiterGuide(page);

    await bar.getByTestId("demo-role-implementation_manager").click();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "AI Evidence" })).toBeVisible();
    await startRoleWalkthrough(page);
    await expect(page.getByTestId("tour-coachmark").getByRole("heading", { name: "Portfolio health" })).toBeVisible();
    await closeRecruiterGuide(page);
  });

  test("resolves every role-aware coachmark to permitted visible evidence", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Start 90-second tour" }).click();
    await page.waitForURL("**/dashboard");

    await walkCoachmarks(page, [
      "Portfolio health",
      "Plan and source",
      "AI run details",
      "Plan approval",
      "Generate a plan",
      "New board tasks",
      "Failed job recovery",
      "Customer update",
    ]);

    for (const persona of [
      {
        role: "solutions_engineer",
        titles: ["Requirements", "Source documents", "Generate a plan", "Task board", "Job status"],
      },
      {
        role: "customer_stakeholder",
        titles: ["Project overview", "Timeline", "Published updates"],
      },
      {
        role: "org_admin",
        titles: ["Portfolio health", "Team access", "Audit history", "Background jobs"],
      },
    ] as const) {
      await page.getByTestId(`demo-role-${persona.role}`).click();
      await expect(page.getByTestId(`demo-role-${persona.role}`)).toHaveAttribute("aria-pressed", "true");
      await startRoleWalkthrough(page);
      await walkCoachmarks(page, [...persona.titles]);
    }
  });

  test("keeps the authenticated shell operable on a phone-sized viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Start 90-second tour" }).click();
    await page.waitForURL("**/dashboard");
    await closeRecruiterGuide(page);
    await expect(page.getByRole("button", { name: /Open navigation/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: /Open navigation/ }).click();
    const mobileNav = page.getByRole("navigation", { name: "Mobile main navigation" });
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole("button", { name: "Open search" })).toBeVisible();
    await expect(mobileNav.getByRole("button", { name: "Sign out" })).toBeVisible();
    await mobileNav.getByRole("button", { name: "Open search" }).click();
    await expect(page.getByRole("dialog", { name: "Global search" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("demo-role-select").selectOption("org_admin");
    await expect(page.getByTestId("demo-role-select")).toHaveValue("org_admin");
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings\/?$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("adapts persona and project navigation from 320px through ultrawide", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Start 90-second tour" }).click();
    await page.waitForURL("**/dashboard");
    await closeRecruiterGuide(page);

    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoInternalOverflow(page, "demo-role-bar");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width < 1280) {
        await expect(page.getByTestId("demo-role-select")).toBeVisible();
        await expect(page.getByTestId("demo-role-implementation_manager")).toBeHidden();
      } else {
        await expect(page.getByTestId("demo-role-select")).toBeHidden();
        await expect(page.getByTestId("demo-role-implementation_manager")).toBeVisible();
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/projects");
    await page.getByRole("link", { name: "Order Intake Automation", exact: true }).first().click();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("All projects");

    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoInternalOverflow(page, "project-navigation");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width < 1280) {
        await expect(page.getByTestId("project-section-select")).toBeVisible();
        await expect(page.getByTestId("project-tabs")).toBeHidden();
      } else {
        await expect(page.getByTestId("project-section-select")).toBeHidden();
        await expect(page.getByTestId("project-tabs")).toBeVisible();
      }
    }
  });

  test("coachmark navigation is reversible, anchored, and guide-only", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Start 90-second tour" }).click();
    await page.waitForURL("**/dashboard");
    const mutationRequests: string[] = [];
    page.on("request", (request) => {
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
        mutationRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    const coachmark = page.getByTestId("tour-coachmark");
    await expect(coachmark).toBeVisible();
    await expect(page.locator('[data-tour-target="dashboard-portfolio-health"]')).toHaveAttribute("data-tour-active", "true");
    await expect(page.getByTestId("tour-spotlight")).toHaveCSS("pointer-events", "none");
    await page.evaluate(() => window.scrollBy(0, 240));
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.getByTestId("tour-coachmark-arrow")).toBeVisible();
    await expect(page.getByTestId("tour-spotlight")).toBeVisible();
    expect(await page.evaluate(() => {
      const card = document.querySelector('[data-testid="tour-coachmark"]')?.getBoundingClientRect();
      const target = document.querySelector('[data-tour-active="true"]')?.getBoundingClientRect();
      if (!card || !target) return false;
      return card.right <= target.left || card.left >= target.right || card.bottom <= target.top || card.top >= target.bottom;
    })).toBe(true);

    await coachmark.getByTestId("tour-coachmark-next").click();
    await page.waitForURL("**/plan");
    await expect(coachmark.getByRole("heading", { name: "Plan and source" })).toBeVisible();
    await coachmark.getByRole("button", { name: "Back" }).click();
    await page.waitForURL("**/dashboard");
    await expect(coachmark.getByRole("heading", { name: "Portfolio health" })).toBeVisible();
    await coachmark.getByRole("button", { name: "All steps" }).click();
    await page.getByTestId("tour-restart").click();
    await expect(coachmark.getByRole("heading", { name: "Portfolio health" })).toBeVisible();
    expect(mutationRequests).toEqual([]);
  });

  test("offers a bounded fallback when a tour target is unavailable", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start 90-second tour" }).click();
    await page.waitForURL("**/dashboard");
    await closeRecruiterGuide(page);
    await page.locator('[data-tour-target="dashboard-portfolio-health"]').evaluate((element) => element.remove());
    await page.getByTestId("tour-open").click();
    const coachmark = page.getByTestId("tour-coachmark");
    await expect(coachmark.getByRole("heading", { name: "This item is no longer here" })).toBeVisible({ timeout: 7_000 });
    await expect(coachmark.getByRole("button", { name: "Return to destination" })).toBeVisible();
    await coachmark.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/plan");
    await expect(coachmark.getByRole("heading", { name: "Plan and source" })).toBeVisible();
  });

  test("requires confirmation and issues a fresh demo on reset", async ({ page }) => {
    await page.goto("/");
    const launch = page.waitForResponse("**/api/demo/session");
    await page.getByRole("button", { name: "Start 90-second tour" }).click();
    const launchResponse = await launch;
    const firstWorkspace = ((await launchResponse.json()) as { workspaceId: string }).workspaceId;
    await page.waitForURL("**/dashboard");

    const unconfirmed = await page.request.post("/api/demo/reset", { data: {} });
    expect(unconfirmed.status()).toBe(400);
    const reset = await page.request.post("/api/demo/reset", { data: { confirmed: true } });
    expect(reset.status()).toBe(200);
    const secondWorkspace = ((await reset.json()) as { workspaceId: string }).workspaceId;
    expect(secondWorkspace).not.toBe(firstWorkspace);
  });

  test("keeps the guided walkthrough usable on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Start 90-second tour" }).click();
    await page.waitForURL("**/dashboard");
    await expect(page.getByTestId("tour-coachmark")).toBeVisible();
    await expect(page.getByTestId("tour-spotlight")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.locator("#main-content").evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(700);
    await expect(page.locator("#portfolio-health-heading")).toBeVisible();
  });
});

test.describe("authentication & RBAC", () => {
  test("rejects bad credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@northwind.dev");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid email or password")).toBeVisible();
  });

  test("redirects unauthenticated visitors to login", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page).toHaveURL(/\/login/);
  });

  test("manager sees the full internal navigation", async ({ page }) => {
    await login(page, "manager@northwind.dev");
    const nav = page.getByRole("navigation");
    for (const label of ["Dashboard", "Projects", "Approvals", "Audit Log", "Operations"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    // Settings is admin-only.
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
  });

  test("customer stakeholder gets a restricted view", async ({ page }) => {
    await login(page, "customer@brightlane.dev");
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Projects" })).toBeVisible();
    for (const label of ["Approvals", "Insights", "Audit Log", "Operations", "Settings"]) {
      await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
    }
    // Direct navigation to internal pages/APIs is also denied.
    const res = await page.request.get("/api/v1/audit");
    expect(res.status()).toBe(403);
    expect((await page.request.get("/api/v1/ai-runs")).status()).toBe(403);
    const projectsResponse = await page.request.get("/api/v1/projects");
    const projects = (await projectsResponse.json()) as {
      projects: Array<{ id: string }>;
    };
    const projectId = projects.projects[0].id;
    expect(
      (await page.request.get(`/api/v1/projects/${projectId}/documents`)).status(),
    ).toBe(403);
    await page.goto(`/projects/${projectId}/board`);
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    await page.goto("/insights");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe("seeded delivery data", () => {
  test("project board shows tasks across workflow columns", async ({ page }) => {
    await login(page, "engineer@northwind.dev");
    // Go straight to /projects: the dashboard now lists project names in both
    // the delivery-risk panel and the projects card, so a nav-click-then-locate
    // races the client-side transition.
    await page.goto("/projects");
    await page.getByRole("link", { name: "Order Intake Automation" }).click();
    const tabs = page.getByRole("navigation", { name: "Project sections" });
    await expect(tabs.getByRole("link", { name: "Timeline" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Documents" })).toBeVisible();
    await tabs.getByRole("link", { name: "Delivery" }).click();
    // Column headers use exact, case-sensitive text so they don't collide with
    // the lowercase "in progress" <option>s inside each card's status select.
    await expect(page.getByText("To do", { exact: true })).toBeVisible();
    await expect(page.getByText("In progress", { exact: true })).toBeVisible();
    await expect(page.getByText("Done", { exact: true })).toBeVisible();
    // A seeded task known to be in the Done column.
    await expect(
      page.getByText("Run kickoff workshop and confirm requirement priorities"),
    ).toBeVisible();
  });

  test("approved plan renders with milestones and risks", async ({ page }) => {
    await login(page, "manager@northwind.dev");
    await page.goto("/projects");
    await page.getByRole("link", { name: "Order Intake Automation" }).click();
    await page.getByRole("link", { name: "Plan" }).click();
    await expect(page.getByText("Plan v2")).toBeVisible();
    await expect(page.getByText("Milestones & tasks")).toBeVisible();
    await expect(page.getByText("Discovery & Kickoff")).toBeVisible();
  });

  test("revised plan shows the incorporated feedback and a version diff", async ({ page }) => {
    await login(page, "manager@northwind.dev");
    await page.goto("/projects");
    await page.getByRole("link", { name: "Order Intake Automation" }).click();
    await page.getByRole("link", { name: "Plan" }).click();
    // The closed-loop banner and the "what changed" panel.
    await expect(page.getByText("Revised from reviewer feedback:")).toBeVisible();
    await expect(page.getByText("Changes from v1")).toBeVisible();
    // v2 restored the launch milestone that v1 lacked.
    await expect(page.getByText(/Milestone added: Launch & Handoff/)).toBeVisible();
  });

  test("customer sees published updates but not internal tabs", async ({ page }) => {
    await login(page, "customer@brightlane.dev");
    await page.goto("/projects");
    await page.getByRole("link", { name: "Order Intake Automation" }).click();
    const tabs = page.getByRole("navigation", { name: "Project sections" });
    await expect(tabs.getByRole("link", { name: "Communications" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Delivery" })).toHaveCount(0);
    await expect(tabs.getByRole("link", { name: "Scope" })).toHaveCount(0);
    await tabs.getByRole("link", { name: "Communications" }).click();
    await expect(
      page.getByText("Order Intake Automation — Progress Update"),
    ).toBeVisible();
  });

  // Runs before the bulk-approval test on purpose: that test publishes the
  // drafts this one asserts are hidden.
  test("customer timeline shows progress without leaking internal review state", async ({
    page,
  }) => {
    await login(page, "customer@brightlane.dev");
    await page.goto("/projects");
    await page.getByRole("link", { name: "Order Intake Automation" }).click();
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("link", { name: "Timeline" })
      .click();

    // Delivery phases with their status, and overall progress.
    await expect(page.getByRole("heading", { name: "Delivery phases" })).toBeVisible();
    await expect(page.getByText("Discovery & Kickoff")).toBeVisible();
    await expect(page.getByText(/of 5 phases complete/)).toBeVisible();

    // The published update is here...
    await expect(
      page.getByText("Order Intake Automation — Progress Update"),
    ).toBeVisible();
    // ...but the update still awaiting internal approval is not.
    await expect(
      page.getByText("Order Intake Automation — Milestone Update"),
    ).toHaveCount(0);
    // And no internal review history leaks in (the seeded v1 rejection).
    await expect(page.getByText(/wrong sequencing/i)).toHaveCount(0);
    await expect(page.getByText(/rejected/i)).toHaveCount(0);
  });

  test("ops page shows job history including the dead-letter job", async ({ page }) => {
    await login(page, "admin@northwind.dev");
    await page.getByRole("link", { name: "Operations" }).click();
    await expect(page.getByText("Success rate")).toBeVisible();
    await expect(page.getByText("dead letter").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" }).first()).toBeVisible();
  });

  test("insights page surfaces AI quality and delivery metrics", async ({ page }) => {
    await login(page, "manager@northwind.dev");
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Insights" })
      .click();
    await expect(
      page.getByRole("heading", { name: "AI output quality" }),
    ).toBeVisible();
    await expect(page.getByText("Plan approval rate")).toBeVisible();
    await expect(page.getByText("Quality by prompt version")).toBeVisible();
    await expect(page.getByRole("cell", { name: "plan-v1.0" })).toBeVisible();
    // The seeded rejection surfaces in the reason-code breakdown.
    await expect(page.getByText("wrong sequencing")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Delivery health" }),
    ).toBeVisible();
  });

  test("dashboard surfaces SLA delivery-risk flags", async ({ page }) => {
    await login(page, "manager@northwind.dev"); // lands on /dashboard
    const panel = page.locator("div.card", { hasText: "Delivery risk" });
    await expect(
      panel.getByRole("heading", { name: "Delivery risk" }),
    ).toBeVisible();
    // Order Intake has a task blocked past the breach threshold — stable across
    // the suite since no other test unblocks it.
    const orderRow = panel.locator("li", { hasText: "Order Intake Automation" });
    await expect(orderRow.getByText("Breached")).toBeVisible();
    await expect(orderRow.getByText(/task blocked/i)).toBeVisible();
  });

  // Runs before the rejection test, which clears the pending approval this
  // relies on. Resets the policy at the end so it stays hermetic.
  test("a per-project SLA override changes the risk verdict", async ({ page }) => {
    await login(page, "manager@northwind.dev");
    await page.goto("/projects");
    await page.getByRole("link", { name: "Claims Status Tracker" }).click();
    // Wait for the client-side transition to commit before reading the id.
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
    const projectId = new URL(page.url()).pathname.split("/")[2];

    // Default thresholds: its 2-day-old approval is only "at risk".
    await expect(page.getByText("Using org defaults")).toBeVisible();
    await page.goto("/dashboard");
    const claimsRow = page
      .locator("div.card", { hasText: "Delivery risk" })
      .locator("li", { hasText: "Claims Status Tracker" });
    await expect(claimsRow.getByText("At risk")).toBeVisible();
    await expect(claimsRow.getByText("Custom SLA")).toHaveCount(0);

    // Tighten the approval breach threshold to 24h.
    await page.goto(`/projects/${projectId}`);
    await page.getByLabel("Breach after an approval waits").fill("24");
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/sla-policy") && r.request().method() === "PUT",
      ),
      page.getByRole("button", { name: "Save policy" }).click(),
    ]);
    await expect(page.getByTestId("sla-saved")).toBeVisible();

    // Same data, stricter policy — now a breach, and flagged as custom.
    await page.goto("/dashboard");
    await expect(claimsRow.getByText("Breached")).toBeVisible();
    await expect(claimsRow.getByText("Custom SLA")).toBeVisible();

    // Incoherent thresholds are rejected against the *resolved* policy.
    const bad = await page.request.put(`/api/v1/projects/${projectId}/sla-policy`, {
      data: { approvalWarnHours: 200 },
    });
    expect(bad.status()).toBe(400);

    // Reset so the rest of the suite sees default thresholds.
    const reset = await page.request.delete(`/api/v1/projects/${projectId}/sla-policy`);
    expect(reset.status()).toBe(200);
  });

  test("SLA policy changes require projects.manage", async ({ page }) => {
    await login(page, "engineer@northwind.dev");
    await page.goto("/projects");
    await page.getByRole("link", { name: "Claims Status Tracker" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
    const projectId = new URL(page.url()).pathname.split("/")[2];

    const res = await page.request.put(`/api/v1/projects/${projectId}/sla-policy`, {
      data: { approvalWarnHours: 1 },
    });
    expect(res.status()).toBe(403);
    // The editor is not rendered for them either.
    await expect(page.getByRole("button", { name: "Save policy" })).toHaveCount(0);
  });

  test("rejecting a plan with auto-regenerate queues a revised version", async ({ page }) => {
    await login(page, "manager@northwind.dev");
    await page.goto("/approvals");
    // The seeded planning project has a plan awaiting review.
    const card = page.locator("div.card", { hasText: "Claims Status Tracker" });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: /^Reject/ }).click();
    // The auto-regenerate option is on by default for plan rejections. Named
    // explicitly — the card also carries a bulk-selection checkbox.
    await expect(
      card.getByRole("checkbox", { name: /Automatically generate a revised plan/i }),
    ).toBeChecked();
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/decision") && r.request().method() === "POST",
      ),
      card.getByRole("button", { name: "Confirm rejection" }).click(),
    ]);
    // The confirmation only renders when the API returned a regeneration job id.
    await expect(card.getByText(/generating a revised plan/i)).toBeVisible();
  });

  test("bulk-approves a selection from the queue", async ({ page }) => {
    await login(page, "manager@northwind.dev");
    await page.goto("/approvals");

    // Select the two seeded customer updates awaiting review.
    await page
      .getByRole("checkbox", { name: /Select customer update for Order Intake/i })
      .check();
    await page
      .getByRole("checkbox", { name: /Select customer update for Patient Onboarding/i })
      .check();
    await expect(page.getByTestId("bulk-count")).toHaveText("2 selected");

    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/approvals/bulk") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Approve selected" }).click(),
    ]);

    // Partial-success summary comes straight from the API.
    await expect(page.getByTestId("bulk-summary")).toHaveText("Approved 2");
  });

  test("bulk decisions are gated by the approvals.decide permission", async ({ page }) => {
    await login(page, "engineer@northwind.dev");
    // A solutions engineer can generate plans but must not decide on them.
    const res = await page.request.post("/api/v1/approvals/bulk", {
      data: {
        approvalIds: ["3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
        decision: "approved",
      },
    });
    expect(res.status()).toBe(403);
    // The bulk controls are not rendered for them either.
    await page.goto("/approvals");
    await expect(
      page.getByRole("button", { name: "Approve selected" }),
    ).toHaveCount(0);
  });
});

test.describe("global search palette", () => {
  test("opens from the sidebar and navigates to a matched project", async ({ page }) => {
    await login(page, "engineer@northwind.dev");
    await page.getByRole("button", { name: "Open search" }).click();
    const dialog = page.getByRole("dialog", { name: "Global search" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Search query" }).fill("Order Intake");
    // The project title also appears as the subtitle of matched requirements, so
    // target the project result specifically via its "in delivery" status line.
    const projectHit = dialog.getByRole("button", {
      name: /Order Intake Automation.*in delivery/,
    });
    await expect(projectHit).toBeVisible();
    await projectHit.click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
    await expect(
      page.getByRole("heading", { name: "Order Intake Automation" }),
    ).toBeVisible();
  });

  test("keyboard shortcut opens the palette and Escape closes it", async ({ page }) => {
    await login(page, "manager@northwind.dev");
    const dialog = page.getByRole("dialog", { name: "Global search" });
    // Open via the button first: a working onClick proves the client component
    // has hydrated, so the window key listener (same effect lifecycle) is live.
    await page.getByRole("button", { name: "Open search" }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // Now the ⌘K / Ctrl+K shortcut.
    await page.keyboard.press("ControlOrMeta+KeyK");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("a requirement match lands on the project's requirements tab", async ({ page }) => {
    await login(page, "engineer@northwind.dev");
    await page.getByRole("button", { name: "Open search" }).click();
    const dialog = page.getByRole("dialog", { name: "Global search" });
    await dialog
      .getByRole("textbox", { name: "Search query" })
      .fill("carrier assignment");
    const hit = dialog.getByText("Automated carrier assignment rules");
    await expect(hit).toBeVisible();
    await hit.click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/requirements/);
  });

  test("result types are gated by role", async ({ page }) => {
    // Customer stakeholder may only ever get project results.
    await login(page, "customer@brightlane.dev");
    const denied = await page.request.get("/api/v1/search?q=Harbor%20Health");
    const cust = await denied.json();
    expect(cust.results.length).toBeGreaterThan(0);
    expect(cust.results.every((r: { type: string }) => r.type === "project")).toBe(
      true,
    );

    // The same query as a manager surfaces the customer entity too.
    await page.request.post("/api/auth/logout");
    await login(page, "manager@northwind.dev");
    const res = await page.request.get("/api/v1/search?q=Harbor%20Health");
    const mgr = await res.json();
    expect(mgr.results.some((r: { type: string }) => r.type === "customer")).toBe(
      true,
    );
  });
});

test.describe("enterprise settings", () => {
  test("shows and requires acknowledgement of a webhook signing secret", async ({ page }) => {
    await login(page, "admin@northwind.dev");
    await page.goto("/settings/integrations");
    await expect(page).toHaveURL(/\/settings\/integrations\/?$/);
    await page.getByLabel("HTTPS endpoint").fill(`https://example.com/workbench-${Date.now()}`);
    await page.getByLabel("Event").selectOption("task.status_changed");
    await page.getByRole("button", { name: "Add endpoint" }).click();
    await expect(page.getByTestId("webhook-signing-secret")).toContainText("whsec_");
    await expect(page.getByRole("button", { name: "Save current secret first" })).toBeDisabled();
    await page.getByRole("button", { name: "I've saved it" }).click();
    await expect(page.getByTestId("webhook-signing-secret")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add endpoint" })).toBeEnabled();
  });
});

test.describe("API contract", () => {
  test("serves the OpenAPI document publicly", async ({ request }) => {
    const res = await request.get("/api/openapi.json");
    expect(res.ok()).toBeTruthy();
    const doc = await res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain(
      "/api/v1/approvals/{approvalId}/decision",
    );
  });

  test("health endpoint reports dependency status without auth", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("healthy");
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.queue.ok).toBe(true);
  });

  test("audit CSV export is gated and returns CSV for authorized users", async ({ page }) => {
    // Customer stakeholder is denied.
    await login(page, "customer@brightlane.dev");
    const denied = await page.request.get("/api/v1/audit/export");
    expect(denied.status()).toBe(403);

    // Manager gets a CSV attachment with a header row.
    await page.request.post("/api/auth/logout");
    await login(page, "manager@northwind.dev");
    const res = await page.request.get("/api/v1/audit/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const csv = await res.text();
    expect(csv.split("\n")[0]).toContain("timestamp,actor,action");
  });
});

test.describe("full async workflow (requires worker: E2E_WORKER=1)", () => {
  test.skip(
    process.env.E2E_WORKER !== "1",
    "needs `npm run worker` + LocalStack running",
  );

  test("generate plan → approve → tasks appear on the board", async ({ page }) => {
    await login(page, "engineer@northwind.dev");
    await page.goto("/projects");
    await page.getByRole("link", { name: "Patient Onboarding Portal" }).click();
    const tabs = page.getByRole("navigation", { name: "Project sections" });
    await tabs.getByRole("link", { name: "Plan" }).click();
    await page
      .getByRole("button", { name: /Generate implementation plan|Regenerate plan/ })
      .click();
    // Worker picks the job off SQS, calls the provider, validates, persists.
    await expect(page.getByText(/Plan v\d/)).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("awaiting review")).toBeVisible();

    // Manager approves it from the queue.
    await page.getByRole("button", { name: "Sign out" }).click();
    await login(page, "manager@northwind.dev");
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Approvals" })
      .click();
    // Scope to this project's card: the queue holds other pending items, so
    // .first() would decide the wrong one. Wait for the decision POST itself
    // before navigating — the button flips to "Working…" instantly, so we
    // can't key off its label.
    const card = page.locator("div.card", { hasText: "Patient Onboarding Portal" });
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/decision") && r.request().method() === "POST",
      ),
      card.getByRole("button", { name: "Approve", exact: true }).first().click(),
    ]);

    // Approving materializes the plan's tasks onto the delivery board.
    await page.goto("/projects");
    await page.getByRole("link", { name: "Patient Onboarding Portal" }).click();
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("link", { name: "Delivery" })
      .click();
    await expect(page.getByText("Run kickoff workshop").first()).toBeVisible();
  });
});
