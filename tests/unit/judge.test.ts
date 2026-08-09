import { describe, expect, it } from "vitest";
import { parseJudgeOutput } from "@/lib/evals/judge";

describe("LLM judge contract", () => {
  it("accepts fenced JSON and validates the five-point rubric", () => {
    const result = parseJudgeOutput(
      "```json\n" +
        '{"clarity":4,"actionability":5,"businessTone":4,"scopeDiscipline":3,"overall":4,"rationale":"Concrete and appropriately scoped."}' +
        "\n```",
    );
    expect(result.overall).toBe(4);
  });

  it("rejects scores outside the calibration rubric", () => {
    expect(() =>
      parseJudgeOutput(
        JSON.stringify({
          clarity: 6,
          actionability: 5,
          businessTone: 5,
          scopeDiscipline: 5,
          overall: 5,
          rationale: "invalid",
        }),
      ),
    ).toThrow();
  });
});
