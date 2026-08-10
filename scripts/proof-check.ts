import { existsSync } from "node:fs";
import { join } from "node:path";
import { getProofManifest, proofClaims } from "@/lib/proof";

const root = process.cwd();
const allowedKinds = new Set(["demo", "test", "ci", "api", "adr", "runbook", "artifact"]);
const failures: string[] = [];

for (const claim of proofClaims) {
  if (!claim.id || !claim.title || !claim.summary) failures.push("Claim " + (claim.id || "<missing>") + " is incomplete");
  if (claim.evidence.length === 0) failures.push("Claim " + claim.id + " has no evidence");
  if (claim.status === "verified" && !claim.evidence.some((evidence) => ["test", "ci", "api", "artifact", "runbook"].includes(evidence.kind))) {
    failures.push("Verified claim " + claim.id + " needs executable or documentary evidence");
  }
  for (const evidence of claim.evidence) {
    if (!allowedKinds.has(evidence.kind)) failures.push("Claim " + claim.id + " has unsupported evidence kind " + evidence.kind);
    if (!evidence.href || /password|token=|secret=/i.test(evidence.href)) failures.push("Claim " + claim.id + " contains unsafe evidence link");
    const githubFile = evidence.href.match(/github\.com\/[^/]+\/[^/]+\/(?:blob|tree)\/[^/]+\/(.+)$/);
    if (githubFile && !existsSync(join(root, githubFile[1]))) {
      failures.push("Claim " + claim.id + " references missing repository evidence: " + githubFile[1]);
    }
  }
}

const manifest = getProofManifest();
if (!manifest.build.commit || !manifest.build.environment) failures.push("Manifest build metadata is incomplete");
if (Object.keys(manifest).some((key) => /password|secret|token/i.test(key))) failures.push("Manifest exposes a sensitive top-level key");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Proof registry check passed: " + manifest.claims.length + " claims, " + manifest.claims.reduce((total, claim) => total + claim.evidence.length, 0) + " evidence links.");
