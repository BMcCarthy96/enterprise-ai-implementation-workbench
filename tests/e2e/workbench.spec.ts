import { test, expect, type Page } from "@playwright/test";

/** Sign in through the real login form. */
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

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
    // Members is admin-only.
    await expect(nav.getByRole("link", { name: "Members" })).toHaveCount(0);
  });

  test("customer stakeholder gets a restricted view", async ({ page }) => {
    await login(page, "customer@brightlane.dev");
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Projects" })).toBeVisible();
    for (const label of ["Approvals", "Insights", "Audit Log", "Operations", "Members"]) {
      await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
    }
    // Direct navigation to internal pages/APIs is also denied.
    const res = await page.request.get("/api/v1/audit");
    expect(res.status()).toBe(403);
    await page.goto("/insights");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe("seeded delivery data", () => {
  test("project board shows tasks across workflow columns", async ({ page }) => {
    await login(page, "engineer@northwind.dev");
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Projects" })
      .click();
    await page.getByRole("link", { name: "Order Intake Automation" }).click();
    const tabs = page.getByRole("navigation", { name: "Project sections" });
    await tabs.getByRole("link", { name: "Board" }).click();
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
    await expect(tabs.getByRole("link", { name: "Updates" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Board" })).toHaveCount(0);
    await expect(tabs.getByRole("link", { name: "Requirements" })).toHaveCount(0);
    await tabs.getByRole("link", { name: "Updates" }).click();
    await expect(
      page.getByText("Order Intake Automation — Progress Update"),
    ).toBeVisible();
  });

  test("ops page shows job history including the dead-letter job", async ({ page }) => {
    await login(page, "admin@northwind.dev");
    await page.getByRole("link", { name: "Operations" }).click();
    await expect(page.getByText("Success rate")).toBeVisible();
    await expect(page.getByText("dead letter").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
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
    await expect(page.getByText("plan-v1.0")).toBeVisible();
    // The seeded rejection surfaces in the reason-code breakdown.
    await expect(page.getByText("wrong sequencing")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Delivery health" }),
    ).toBeVisible();
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
    // Wait for the decision POST itself to complete before navigating — the
    // button flips to "Working…" instantly, so we can't key off its label.
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/decision") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Approve" }).first().click(),
    ]);

    // Approving materializes the plan's tasks onto the delivery board.
    await page.goto("/projects");
    await page.getByRole("link", { name: "Patient Onboarding Portal" }).click();
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("link", { name: "Board" })
      .click();
    await expect(page.getByText("Run kickoff workshop").first()).toBeVisible();
  });
});
