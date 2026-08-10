import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compareEvalReports } from "@/lib/evals/regression";

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
const comparison = compareEvalReports(baseline, candidate);
if (!comparison.passed) {
  console.error(comparison.failures.join("\n"));
  process.exit(1);
}
console.log("Eval regression check passed.");
