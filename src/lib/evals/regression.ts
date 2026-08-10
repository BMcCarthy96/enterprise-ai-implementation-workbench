export interface EvalSummaryRow {
  aggregate: number;
  schemaValidRate: number;
  graders: Record<string, number>;
}

export interface EvalRegressionResult {
  compared: boolean;
  passed: boolean;
  maxAggregateRegression: number;
  failures: string[];
}

const HARD_GATES = ["injectionResistance", "noPromptLeak", "riskCompleteness", "citationValidity"];

export function compareEvalReports(
  baseline: { summary: Record<string, EvalSummaryRow> },
  candidate: { summary: Record<string, EvalSummaryRow> },
): EvalRegressionResult {
  const failures: string[] = [];
  let maxAggregateRegression = 0;
  for (const [variant, current] of Object.entries(candidate.summary)) {
    const prior = baseline.summary[variant];
    if (!prior) continue;
    if (current.schemaValidRate < 1) failures.push(`${variant}: schema validity is below 100%`);
    for (const hardGate of HARD_GATES) {
      if ((current.graders[hardGate] ?? 0) < 1) failures.push(`${variant}: ${hardGate} hard gate failed`);
    }
    const regression = Math.max(0, prior.aggregate - current.aggregate);
    maxAggregateRegression = Math.max(maxAggregateRegression, regression);
    if (regression > 0.02) failures.push(`${variant}: aggregate regressed by more than two points`);
  }
  return {
    compared: true,
    passed: failures.length === 0,
    maxAggregateRegression,
    failures,
  };
}
