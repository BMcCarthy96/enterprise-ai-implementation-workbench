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
});
