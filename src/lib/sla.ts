/**
 * SLA policy: the thresholds that decide when a project is at risk or breached.
 *
 * Pure and dependency-free so the request schema, the risk evaluator, and the
 * settings UI all share one definition. The DB-backed evaluation lives in
 * `src/server/services/sla.ts`.
 */

export interface SlaPolicy {
  /** Flag a project whose target date is within this many days. */
  targetDateWarningDays: number;
  /** Blocked task aging thresholds (days since it went blocked). */
  blockedTaskWarnDays: number;
  blockedTaskBreachDays: number;
  /** Approval-queue aging thresholds (hours pending human review). */
  approvalWarnHours: number;
  approvalBreachHours: number;
}

export const DEFAULT_SLA_POLICY: SlaPolicy = {
  targetDateWarningDays: 14,
  blockedTaskWarnDays: 3,
  blockedTaskBreachDays: 7,
  approvalWarnHours: 24,
  approvalBreachHours: 72,
};

/** A project stores only the fields it overrides, so the rest track the defaults. */
export type SlaPolicyOverride = Partial<SlaPolicy>;

export interface SlaPolicyField {
  key: keyof SlaPolicy;
  label: string;
  unit: "days" | "hours";
  min: number;
  max: number;
  group: "Target date" | "Blocked tasks" | "Approval turnaround";
}

/**
 * Field metadata driving both the zod bounds and the settings form — one place
 * to change when a threshold is added.
 */
export const SLA_POLICY_FIELDS: readonly SlaPolicyField[] = [
  {
    key: "targetDateWarningDays",
    label: "Warn when target date is within",
    unit: "days",
    min: 0,
    max: 365,
    group: "Target date",
  },
  {
    key: "blockedTaskWarnDays",
    label: "Warn after a task is blocked for",
    unit: "days",
    min: 0,
    max: 365,
    group: "Blocked tasks",
  },
  {
    key: "blockedTaskBreachDays",
    label: "Breach after a task is blocked for",
    unit: "days",
    min: 0,
    max: 365,
    group: "Blocked tasks",
  },
  {
    key: "approvalWarnHours",
    label: "Warn after an approval waits",
    unit: "hours",
    min: 1,
    max: 8760,
    group: "Approval turnaround",
  },
  {
    key: "approvalBreachHours",
    label: "Breach after an approval waits",
    unit: "hours",
    min: 1,
    max: 8760,
    group: "Approval turnaround",
  },
] as const;

/** Warn thresholds that must not exceed their matching breach threshold. */
export const SLA_THRESHOLD_PAIRS = [
  { warn: "blockedTaskWarnDays", breach: "blockedTaskBreachDays" },
  { warn: "approvalWarnHours", breach: "approvalBreachHours" },
] as const satisfies ReadonlyArray<{ warn: keyof SlaPolicy; breach: keyof SlaPolicy }>;

/** Merge a partial override over the defaults. Null/undefined = pure defaults. */
export function resolveSlaPolicy(
  override?: SlaPolicyOverride | null,
): SlaPolicy {
  if (!override) return { ...DEFAULT_SLA_POLICY };
  const resolved = { ...DEFAULT_SLA_POLICY };
  for (const field of SLA_POLICY_FIELDS) {
    const value = override[field.key];
    if (typeof value === "number" && Number.isFinite(value)) {
      resolved[field.key] = value;
    }
  }
  return resolved;
}

/** Which fields a project actually overrides (ignoring values equal to default). */
export function effectiveOverrides(
  override?: SlaPolicyOverride | null,
): Array<keyof SlaPolicy> {
  if (!override) return [];
  return SLA_POLICY_FIELDS.filter((f) => {
    const value = override[f.key];
    return typeof value === "number" && value !== DEFAULT_SLA_POLICY[f.key];
  }).map((f) => f.key);
}

/**
 * Ordering errors a resolved policy must not contain (warn after breach would
 * make the warn level unreachable). Returns human-readable messages.
 */
export function policyOrderingErrors(policy: SlaPolicy): string[] {
  const errors: string[] = [];
  for (const pair of SLA_THRESHOLD_PAIRS) {
    if (policy[pair.warn] > policy[pair.breach]) {
      errors.push(
        `${pair.warn} (${policy[pair.warn]}) must not exceed ${pair.breach} (${policy[pair.breach]})`,
      );
    }
  }
  return errors;
}
