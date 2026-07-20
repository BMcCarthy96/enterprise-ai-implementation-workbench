import { describe, expect, it } from "vitest";
import { backoffSeconds } from "@/server/services/jobs";

describe("backoffSeconds", () => {
  it("doubles the delay on each attempt", () => {
    expect(backoffSeconds(1)).toBe(5);
    expect(backoffSeconds(2)).toBe(10);
    expect(backoffSeconds(3)).toBe(20);
    expect(backoffSeconds(4)).toBe(40);
  });

  it("caps at the SQS maximum delay of 900 seconds", () => {
    expect(backoffSeconds(10)).toBe(900);
    expect(backoffSeconds(100)).toBe(900);
  });
});
