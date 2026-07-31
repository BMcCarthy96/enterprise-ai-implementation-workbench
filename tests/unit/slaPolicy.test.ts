import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLA_POLICY,
  SLA_POLICY_FIELDS,
  effectiveOverrides,
  policyOrderingErrors,
  resolveSlaPolicy,
} from "@/lib/sla";
import { UpdateSlaPolicySchema } from "@/lib/apiSchemas";

describe("resolveSlaPolicy", () => {
  it("returns the defaults for null/undefined/empty overrides", () => {
    expect(resolveSlaPolicy(null)).toEqual(DEFAULT_SLA_POLICY);
    expect(resolveSlaPolicy(undefined)).toEqual(DEFAULT_SLA_POLICY);
    expect(resolveSlaPolicy({})).toEqual(DEFAULT_SLA_POLICY);
  });

  it("applies only the overridden fields, leaving the rest on defaults", () => {
    const resolved = resolveSlaPolicy({ approvalWarnHours: 4 });
    expect(resolved.approvalWarnHours).toBe(4);
    expect(resolved.approvalBreachHours).toBe(DEFAULT_SLA_POLICY.approvalBreachHours);
    expect(resolved.blockedTaskWarnDays).toBe(DEFAULT_SLA_POLICY.blockedTaskWarnDays);
  });

  it("does not mutate the shared defaults object", () => {
    const before = { ...DEFAULT_SLA_POLICY };
    resolveSlaPolicy({ approvalWarnHours: 1 }).approvalWarnHours = 999;
    expect(DEFAULT_SLA_POLICY).toEqual(before);
  });

  it("ignores non-numeric junk that slipped into stored JSON", () => {
    const resolved = resolveSlaPolicy({
      approvalWarnHours: "6" as unknown as number,
      blockedTaskWarnDays: Number.NaN,
    });
    expect(resolved.approvalWarnHours).toBe(DEFAULT_SLA_POLICY.approvalWarnHours);
    expect(resolved.blockedTaskWarnDays).toBe(DEFAULT_SLA_POLICY.blockedTaskWarnDays);
  });
});

describe("effectiveOverrides", () => {
  it("is empty for null or an empty object", () => {
    expect(effectiveOverrides(null)).toEqual([]);
    expect(effectiveOverrides({})).toEqual([]);
  });

  it("ignores values that merely restate the default", () => {
    expect(
      effectiveOverrides({
        approvalWarnHours: DEFAULT_SLA_POLICY.approvalWarnHours,
      }),
    ).toEqual([]);
  });

  it("lists genuinely overridden fields", () => {
    expect(effectiveOverrides({ approvalWarnHours: 4, blockedTaskWarnDays: 1 })).toEqual([
      "blockedTaskWarnDays",
      "approvalWarnHours",
    ]);
  });
});

describe("policyOrderingErrors", () => {
  it("accepts the defaults", () => {
    expect(policyOrderingErrors(DEFAULT_SLA_POLICY)).toEqual([]);
  });

  it("accepts equal warn and breach thresholds", () => {
    const policy = resolveSlaPolicy({ approvalWarnHours: 24, approvalBreachHours: 24 });
    expect(policyOrderingErrors(policy)).toEqual([]);
  });

  it("rejects a warn threshold above its breach threshold", () => {
    const policy = resolveSlaPolicy({ blockedTaskWarnDays: 9, blockedTaskBreachDays: 5 });
    expect(policyOrderingErrors(policy)).toHaveLength(1);
    expect(policyOrderingErrors(policy)[0]).toMatch(/blockedTaskWarnDays/);
  });

  // The reason validation runs on the *resolved* policy: a single-field
  // override can invert an inherited default.
  it("catches a partial override that inverts an inherited default", () => {
    const policy = resolveSlaPolicy({ approvalWarnHours: 200 });
    expect(policy.approvalBreachHours).toBe(DEFAULT_SLA_POLICY.approvalBreachHours);
    expect(policyOrderingErrors(policy)).toHaveLength(1);
  });

  it("reports both pairs when both are inverted", () => {
    const policy = resolveSlaPolicy({
      blockedTaskWarnDays: 30,
      blockedTaskBreachDays: 1,
      approvalWarnHours: 100,
      approvalBreachHours: 2,
    });
    expect(policyOrderingErrors(policy)).toHaveLength(2);
  });
});

describe("UpdateSlaPolicySchema", () => {
  it("accepts an empty object (reset to defaults)", () => {
    expect(UpdateSlaPolicySchema.parse({})).toEqual({});
  });

  it("accepts a partial override", () => {
    expect(UpdateSlaPolicySchema.parse({ approvalWarnHours: 6 })).toEqual({
      approvalWarnHours: 6,
    });
  });

  it("rejects unknown keys rather than silently dropping a typo", () => {
    expect(() =>
      UpdateSlaPolicySchema.parse({ aprovalWarnHours: 6 }),
    ).toThrow();
  });

  it("rejects non-integer and out-of-range values", () => {
    expect(() => UpdateSlaPolicySchema.parse({ approvalWarnHours: 1.5 })).toThrow();
    expect(() => UpdateSlaPolicySchema.parse({ approvalWarnHours: 0 })).toThrow();
    expect(() => UpdateSlaPolicySchema.parse({ approvalWarnHours: 99999 })).toThrow();
    expect(() => UpdateSlaPolicySchema.parse({ blockedTaskWarnDays: -1 })).toThrow();
  });

  it("covers every policy field", () => {
    const all = Object.fromEntries(SLA_POLICY_FIELDS.map((f) => [f.key, f.min]));
    expect(UpdateSlaPolicySchema.parse(all)).toEqual(all);
  });
});
