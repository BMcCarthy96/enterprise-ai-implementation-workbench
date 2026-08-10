import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MockProvider } from "@/lib/ai/mock";
import { aiProvider } from "@/lib/ai/provider";
import { extractJson } from "@/server/services/planGeneration";
import { PlanContentSchema } from "@/lib/ai/planSchema";
import {
  buildPlanUserPrompt,
  type PlanPromptInput,
} from "@/lib/ai/prompts";
import { promptVariants } from "@/lib/ai/promptRegistry";
import { gradePlan, schemaGrade } from "@/lib/evals/graders";
import { EvalCaseSchema, type EvalCaseResult } from "@/lib/evals/types";
import { compareEvalReports } from "@/lib/evals/regression";

const root = process.cwd();
const casesDir = join(root, "evals", "cases");
const reportsDir = join(root, "evals", "reports");

async function main() {
  const allCases = readdirSync(casesDir)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      const parsed: unknown = JSON.parse(readFileSync(join(casesDir, file), "utf8"));
      return Array.isArray(parsed) ? parsed : [parsed];
    })
    .map((value) => EvalCaseSchema.parse(value));
  const cases = process.argv.includes("--smoke") ? allCases.slice(0, 4) : allCases;
  const provider = process.argv.includes("--live") ? await aiProvider() : new MockProvider();
  const results: EvalCaseResult[] = [];

  for (const variant of promptVariants()) {
    for (const testCase of cases) {
      const input = testCase.project as PlanPromptInput;
      try {
        const response = await provider.complete({
          system: variant.system,
          user: buildPlanUserPrompt(input),
        });
        const raw = JSON.parse(extractJson(response.text)) as unknown;
        const parsed = PlanContentSchema.safeParse(raw);
        const grades = [schemaGrade(raw)];
        if (parsed.success) grades.push(...gradePlan(input, parsed.data));
        results.push({
          caseId: testCase.id,
          category: testCase.category,
          promptVersion: variant.version,
          schemaValid: parsed.success,
          grades,
          aggregate: average(grades),
          output: parsed.success ? parsed.data : raw,
          error: parsed.success ? undefined : parsed.error.message,
        });
      } catch (error) {
        results.push({
          caseId: testCase.id,
          category: testCase.category,
          promptVersion: variant.version,
          schemaValid: false,
          grades: [
            {
              name: "schemaValid",
              score: 0,
              detail: String(error),
            },
          ],
          aggregate: 0,
          error: String(error),
        });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    provider: provider.name,
    caseCount: cases.length,
    variantCount: promptVariants().length,
    results,
    summary: summarize(results),
  };
  mkdirSync(reportsDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  writeFileSync(join(reportsDir, `${stamp}.json`), JSON.stringify(report, null, 2));
  if (!process.argv.includes("--smoke")) {
    const baselinePath = join(root, "evals", "baseline.json");
    const baseline = existsSync(baselinePath)
      ? JSON.parse(readFileSync(baselinePath, "utf8")) as { summary: typeof report.summary }
      : null;
    const regression = baseline ? compareEvalReports(baseline, report) : { compared: false, passed: true, maxAggregateRegression: 0, failures: [] };
    writeFileSync(join(reportsDir, "latest.json"), JSON.stringify(report, null, 2));
    writeFileSync(join(reportsDir, "latest.md"), toMarkdown(report));
    writeFileSync(
      join(root, "evals", "scoreboard.json"),
      JSON.stringify(
        {
          suiteVersion: "offline-eval-v2",
          generatedAt: report.generatedAt,
          provider: report.provider,
          caseCount: report.caseCount,
          variantCount: report.variantCount,
          categories: Object.fromEntries([...new Set(cases.map((testCase) => testCase.category))].map((category) => [category, cases.filter((testCase) => testCase.category === category).length])),
          hardGatesPassed: Object.values(report.summary).every((summary) => ["injectionResistance", "noPromptLeak", "riskCompleteness", "citationValidity"].every((name) => (summary.graders[name] ?? 0) >= 1) && summary.schemaValidRate === 1),
          baseline: regression,
          variants: Object.fromEntries(
            Object.entries(report.summary).map(([variant, summary]) => [variant, {
              schemaValidRate: summary.schemaValidRate,
              aggregate: summary.aggregate,
              graders: summary.graders,
              citationValidity: summary.graders.citationValidity ?? null,
              injectionResistance: summary.graders.injectionResistance ?? null,
            }]),
          ),
        },
        null,
        2,
      ),
    );
  }

  if (process.argv.includes("--write-baseline")) {
    writeFileSync(join(root, "evals", "baseline.json"), JSON.stringify(report, null, 2));
  }
  console.log(toMarkdown(report));
}

function average(grades: Array<{ score: number }>): number {
  return grades.length
    ? grades.reduce((sum, grade) => sum + grade.score, 0) / grades.length
    : 0;
}

function summarize(results: EvalCaseResult[]) {
  return Object.fromEntries(
    promptVariants().map((variant) => {
      const rows = results.filter((result) => result.promptVersion === variant.version);
      const scores = rows.flatMap((row) => row.grades);
      return [
        variant.version,
        {
          cases: rows.length,
          schemaValidRate: rows.filter((row) => row.schemaValid).length / rows.length,
          aggregate: average(rows.map((row) => ({ score: row.aggregate }))),
          graders: Object.fromEntries(
            [...new Set(scores.map((grade) => grade.name))].map((name) => {
              const matching = scores.filter((grade) => grade.name === name);
              return [name, average(matching)];
            }),
          ),
        },
      ];
    }),
  );
}

function toMarkdown(report: {
  generatedAt: string;
  provider: string;
  caseCount: number;
  summary: Record<string, { schemaValidRate: number; aggregate: number; graders: Record<string, number> }>;
}) {
  const lines = [
    `# Eval report`,
    ``,
    `Generated: ${report.generatedAt} · Provider: ${report.provider} · Cases: ${report.caseCount}`,
    ``,
    `| Prompt variant | Schema valid | Aggregate | Coverage | Citations | Injection resistance |`,
    `| --- | ---: | ---: | ---: | ---: | ---: |`,
  ];
  for (const [variant, summary] of Object.entries(report.summary)) {
    lines.push(
      `| ${variant} | ${(summary.schemaValidRate * 100).toFixed(0)}% | ${(summary.aggregate * 100).toFixed(1)}% | ${((summary.graders.requirementCoverage ?? 0) * 100).toFixed(0)}% | ${((summary.graders.citationValidity ?? 0) * 100).toFixed(0)}% | ${((summary.graders.injectionResistance ?? 0) * 100).toFixed(0)}% |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function mainGuard() {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

mainGuard();
