import "dotenv/config";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MockProvider } from "@/lib/ai/mock";
import { extractJson } from "@/server/services/planGeneration";
import { buildPlanUserPrompt, type PlanPromptInput } from "@/lib/ai/prompts";
import { promptVariants } from "@/lib/ai/promptRegistry";
import { EvalCaseSchema } from "@/lib/evals/types";
import { calibrationReport } from "@/lib/evals/calibration";
import { aiProvider } from "@/lib/ai/provider";
import { PlanContentSchema } from "@/lib/ai/planSchema";
import { judgePlan } from "@/lib/evals/judge";

const root = process.cwd();
const dir = join(root, "evals", "calibration");

async function generate() {
  const cases = readdirSync(join(root, "evals", "cases"))
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      const parsed: unknown = JSON.parse(readFileSync(join(root, "evals", "cases", file), "utf8"));
      return Array.isArray(parsed) ? parsed : [parsed];
    })
    .map((value) => EvalCaseSchema.parse(value));
  const provider = new MockProvider();
  const candidates: Array<{ candidateId: string; category: string; output: unknown; humanScore?: number; judgeScore?: number }> = [];
  const mapping: Record<string, { caseId: string; promptVersion: string }> = {};
  for (let index = 0; index < 15; index += 1) {
    const variant = promptVariants()[index % promptVariants().length];
    const testCase = cases[index % cases.length];
    const result = await provider.complete({ system: variant.system, user: buildPlanUserPrompt(testCase.project as PlanPromptInput) });
    const candidateId = `candidate-${String(index + 1).padStart(2, "0")}`;
    candidates.push({ candidateId, category: testCase.category, output: JSON.parse(extractJson(result.text)) });
    mapping[candidateId] = { caseId: testCase.id, promptVersion: variant.version };
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "candidates.json"), JSON.stringify({ generatedAt: new Date().toISOString(), candidates }, null, 2));
  writeFileSync(join(dir, "mapping.json"), JSON.stringify(mapping, null, 2));
  console.log(`Generated ${candidates.length} blinded candidates. Score each 1–5 in evals/calibration/candidates.json, then run npm run eval:calibration:report.`);
}

function report() {
  const file = JSON.parse(readFileSync(join(dir, "candidates.json"), "utf8")) as { candidates: Array<{ humanScore?: number; judgeScore?: number }> };
  const scores = file.candidates
    .filter((candidate) => candidate.humanScore != null && candidate.judgeScore != null)
    .map((candidate) => ({ human: candidate.humanScore!, judge: candidate.judgeScore! }));
  console.log(JSON.stringify(calibrationReport(scores), null, 2));
}

async function judge() {
  const filePath = join(dir, "candidates.json");
  const mappingPath = join(dir, "mapping.json");
  const file = JSON.parse(readFileSync(filePath, "utf8")) as {
    candidates: Array<{ candidateId: string; output: unknown; judgeScore?: number }>;
  };
  const mapping = JSON.parse(readFileSync(mappingPath, "utf8")) as Record<string, { caseId: string }>;
  const cases = readdirSync(join(root, "evals", "cases"))
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const parsed: unknown = JSON.parse(readFileSync(join(root, "evals", "cases", name), "utf8"));
      return Array.isArray(parsed) ? parsed : [parsed];
    })
    .map((value) => EvalCaseSchema.parse(value));
  const byId = new Map(cases.map((testCase) => [testCase.id, testCase]));
  const provider = await aiProvider();
  if (provider.name === "mock") {
    throw new Error("LLM judge calibration requires AI_PROVIDER=bedrock or AI_PROVIDER=anthropic");
  }
  for (const candidate of file.candidates) {
    const testCase = byId.get(mapping[candidate.candidateId]?.caseId);
    if (!testCase) throw new Error(`No eval case mapping for ${candidate.candidateId}`);
    const plan = PlanContentSchema.parse(candidate.output);
    const judged = await judgePlan(provider, testCase.project as PlanPromptInput, plan);
    candidate.judgeScore = judged.overall;
  }
  writeFileSync(filePath, JSON.stringify(file, null, 2));
  console.log(`Scored ${file.candidates.length} calibration candidates with ${provider.name}. Add humanScore values, then run npm run eval:calibration:report.`);
}

if (process.argv.includes("--report")) report();
else if (process.argv.includes("--judge")) judge().catch((error) => { console.error(error); process.exitCode = 1; });
else generate().catch((error) => { console.error(error); process.exitCode = 1; });
