import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { uuidParam } from "@/server/services/access";

describe("uuidParam", () => {
  it("accepts a well-formed UUID", () => {
    const id = "14a6fb2a-320d-47ef-89ab-f9be22771aae";
    expect(uuidParam(id, "projectId")).toBe(id);
  });

  it.each(["undefined", "not-a-uuid", "", undefined])(
    "rejects %s as a 400 INVALID_IDENTIFIER",
    (value) => {
      expect(() => uuidParam(value, "projectId")).toThrowError(ApiError);
      try {
        uuidParam(value, "projectId");
      } catch (error) {
        expect(error).toMatchObject({
          status: 400,
          code: "INVALID_IDENTIFIER",
        });
      }
    },
  );
});
