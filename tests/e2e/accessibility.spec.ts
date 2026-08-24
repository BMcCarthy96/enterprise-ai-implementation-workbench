import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("public accessibility gates", () => {
  for (const path of ["/", "/proof", "/proof/case-study", "/login"]) {
    test("has no serious axe violations: " + path, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""));
      expect(serious, serious.map((violation) => violation.id + ": " + violation.help).join("\n")).toEqual([]);
    });
  }
});

test.describe("authenticated accessibility gates", () => {
  const routes = [
    { path: "/dashboard", email: "manager@northwind.dev" },
    { path: "/approvals", email: "manager@northwind.dev" },
    { path: "/ai-runs", email: "manager@northwind.dev" },
    { path: "/ops", email: "manager@northwind.dev" },
    { path: "/settings", email: "admin@northwind.dev" },
  ];

  for (const { path, email } of routes) {
    test("has no serious axe violations: " + path, async ({ page }) => {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill("demo1234");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL("**/dashboard");
      await page.goto(path, { waitUntil: "networkidle" });
      await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}/?$`));
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""));
      expect(serious, serious.map((violation) => violation.id + ": " + violation.help).join("\n")).toEqual([]);
    });
  }

  test("approval rejection controls have no serious axe violations", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("manager@northwind.dev");
    await page.getByLabel("Password").fill("demo1234");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");
    await page.goto("/approvals", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/approvals\/?$/);
    await page.getByRole("button", { name: "Reject...", exact: true }).first().click();
    await expect(page.getByLabel("Rejection reason").first()).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""));
    expect(serious, serious.map((violation) => violation.id + ": " + violation.help).join("\n")).toEqual([]);
  });

  test("guided walkthrough passes axe and keyboard checks", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByRole("button", { name: "Start 90-second tour" }).click();
    await page.waitForURL("**/dashboard");

    const coachmark = page.getByTestId("tour-coachmark");
    await expect(coachmark).toBeVisible();
    await expect(coachmark).toBeFocused();
    let results = await new AxeBuilder({ page }).analyze();
    let serious = results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""));
    expect(serious, serious.map((violation) => violation.id + ": " + violation.help).join("\n")).toEqual([]);

    await page.keyboard.press("Tab");
    await expect(coachmark.getByRole("button", { name: "Exit guided walkthrough" })).toBeFocused();
    await coachmark.getByRole("button", { name: "All steps" }).click();
    const panel = page.getByTestId("guided-walkthrough-panel");
    await expect(panel).toHaveAttribute("aria-hidden", "false");
    await expect(panel.getByRole("button", { name: "Minimize guided walkthrough" })).toBeFocused();
    results = await new AxeBuilder({ page }).analyze();
    serious = results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""));
    expect(serious, serious.map((violation) => violation.id + ": " + violation.help).join("\n")).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tour-open")).toBeFocused();
  });
});
