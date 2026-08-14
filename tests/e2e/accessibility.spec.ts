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
  for (const path of ["/dashboard", "/approvals", "/ai-runs", "/ops", "/settings"]) {
    test("has no serious axe violations: " + path, async ({ page }) => {
      await page.goto("/login");
      await page.getByLabel("Email").fill("manager@northwind.dev");
      await page.getByLabel("Password").fill("demo1234");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL("**/dashboard");
      await page.goto(path, { waitUntil: "networkidle" });
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""));
      expect(serious, serious.map((violation) => violation.id + ": " + violation.help).join("\n")).toEqual([]);
    });
  }
});
