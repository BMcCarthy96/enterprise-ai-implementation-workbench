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
