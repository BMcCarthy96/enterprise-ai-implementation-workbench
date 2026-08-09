import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Report = {
  summary: Record<string, { aggregate: number; schemaValidRate: number; graders: Record<string, number> }>;
};

const root = process.cwd();
const baselinePath = join(root, "evals", "baseline.json");
const candidatePath = process.argv[2] ?? join(root, "evals", "reports", "latest.json");
if (!existsSync(baselinePath) || !existsSync(candidatePath)) {
  console.error("Missing eval baseline or candidate report. Run npm run eval:baseline first.");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Report;
const candidate = JSON.parse(readFileSync(candidatePath, "utf8")) as Report;
const failures: string[] = [];
for (const [variant, current] of Object.entries(candidate.summary)) {
  const prior = baseline.summary[variant];
  if (!prior) continue;
  if (current.schemaValidRate < 1) failures.push(`${variant}: schema validity is below 100%`);
  for (const hardGate of ["injectionResistance", "noPromptLeak", "riskCompleteness", "citationValidity"]) {
    if ((current.graders[hardGate] ?? 0) < 1) failures.push(`${variant}: ${hardGate} hard gate failed`);
  }
  if (current.aggregate < prior.aggregate - 0.02) {
    failures.push(`${variant}: aggregate regressed by more than two points`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Eval regression check passed.");
