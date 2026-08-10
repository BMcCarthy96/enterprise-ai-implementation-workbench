import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildOpenApiDocument } from "@/lib/openapi";
import { getProofManifest } from "@/lib/proof";

const root = process.cwd();
const outputDir = join(root, "artifacts", "proof-bundle");
const sourceDir = join(outputDir, "sources");
mkdirSync(sourceDir, { recursive: true });

const requestedSources = [
  "artifacts/evidence",
  "coverage",
  "evals/scoreboard.json",
  "evals/reports/latest.json",
  "evals/reports/latest.md",
  "sbom.json",
  "lighthouse-report",
  "load/results.json",
  "infra/cdk.out",
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "docs/operations.md",
  "docs/case-study.md",
  "docs/adr",
];

const files: Array<{ source: string; destination: string; available: boolean }> = [];
for (const source of requestedSources) {
  const absolute = join(root, source);
  const available = existsSync(absolute);
  const destination = join(sourceDir, source);
  if (available) {
    mkdirSync(join(destination, ".."), { recursive: true });
    cpSync(absolute, destination, { recursive: true });
  }
  files.push({ source, destination: relative(outputDir, destination), available });
}

writeFileSync(join(outputDir, "proof-manifest.json"), JSON.stringify(getProofManifest(), null, 2) + "\n");
writeFileSync(join(outputDir, "openapi.json"), JSON.stringify(buildOpenApiDocument(), null, 2) + "\n");
writeFileSync(
  join(outputDir, "index.json"),
  JSON.stringify(
    {
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      build: getProofManifest().build,
      files: [
        { source: "proof-manifest.json", destination: "proof-manifest.json", available: true },
        { source: "openapi.json", destination: "openapi.json", available: true },
        ...files,
      ],
      note: "Missing optional reports remain explicitly marked unavailable; the bundle never promotes an absent artifact to verified evidence.",
    },
    null,
    2,
  ) + "\n",
);

const available = files.filter((file) => file.available).length;
console.log("Proof bundle written to " + outputDir + " (" + available + "/" + files.length + " optional source artifacts available)");
