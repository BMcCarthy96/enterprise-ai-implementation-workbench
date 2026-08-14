import { existsSync } from "node:fs";
import { join } from "node:path";
import { getProofManifest, proofClaims } from "@/lib/proof";

const root = process.cwd();
const allowedKinds = new Set(["demo", "test", "ci", "api", "adr", "runbook", "artifact"]);
const allowedCheckpoints = new Set(["portfolio-health", "ai-evidence", "role-switching", "dlq-recovery"]);
const failures: string[] = [];

for (const claim of proofClaims) {
  if (!claim.id || !claim.title || !claim.summary) failures.push("Claim " + (claim.id || "<missing>") + " is incomplete");
  if (claim.evidence.length === 0) failures.push("Claim " + claim.id + " has no evidence");
  if (["verified", "ci_verified", "staging_observed"].includes(claim.status) && !claim.evidence.some((evidence) => ["test", "ci", "api", "artifact", "runbook"].includes(evidence.kind))) {
    failures.push("Verified claim " + claim.id + " needs executable or documentary evidence");
  }
  for (const evidence of claim.evidence) {
    if (!allowedKinds.has(evidence.kind)) failures.push("Claim " + claim.id + " has unsupported evidence kind " + evidence.kind);
    if (!evidence.href || /password|token=|secret=/i.test(evidence.href)) failures.push("Claim " + claim.id + " contains unsafe evidence link");
    if (evidence.href.startsWith("/api/") && evidence.href !== "/api/openapi.json") {
      failures.push("Claim " + claim.id + " links to a potentially protected API instead of public evidence: " + evidence.href);
    }
    if (evidence.href.startsWith("/demo?checkpoint=")) {
      const checkpoint = new URL(evidence.href, "https://proof.local").searchParams.get("checkpoint");
      if (!checkpoint || !allowedCheckpoints.has(checkpoint)) {
        failures.push("Claim " + claim.id + " references an unsupported demo checkpoint: " + evidence.href);
      }
    }
    const githubFile = evidence.href.match(/github\.com\/[^/]+\/[^/]+\/(?:blob|tree)\/[^/]+\/(.+)$/);
    if (githubFile && !existsSync(join(root, githubFile[1]))) {
      failures.push("Claim " + claim.id + " references missing repository evidence: " + githubFile[1]);
    }
  }
}

const manifest = getProofManifest();
if (!manifest.build.commit || !manifest.build.environment) failures.push("Manifest build metadata is incomplete");
if (Object.keys(manifest).some((key) => /password|secret|token/i.test(key))) failures.push("Manifest exposes a sensitive top-level key");

const provenanceInputPresent = [
  process.env.PROOF_EVIDENCE_SHA,
  process.env.PROOF_EVIDENCE_RUN_URL,
  process.env.PROOF_EVIDENCE_VERIFIED_AT,
  process.env.PROOF_EVIDENCE_CONCLUSION,
].some(Boolean);
const verifiedClaims = manifest.claims.filter((claim) => claim.status === "ci_verified");
const intendedVerifiedClaims = proofClaims.filter((claim) => claim.status === "ci_verified");

if (provenanceInputPresent && !manifest.provenance.currentBuildVerified) {
  failures.push("Incomplete or stale CI provenance: " + manifest.provenance.reason);
}
if (!manifest.provenance.currentBuildVerified && verifiedClaims.length > 0) {
  failures.push("Manifest promotes CI-verified claims without current successful provenance");
}
if (manifest.provenance.currentBuildVerified) {
  if (verifiedClaims.length !== intendedVerifiedClaims.length) failures.push("Current CI provenance did not promote every intended CI claim");
  for (const claim of verifiedClaims) {
    if (claim.lastVerifiedCommit !== manifest.build.commit) failures.push("Verified claim " + claim.id + " is stamped with a different commit");
    if (!claim.verification?.workflowRunUrl || claim.verification.conclusion !== "success") failures.push("Verified claim " + claim.id + " lacks successful workflow provenance");
    if (!claim.verification?.verifiedAt || Number.isNaN(Date.parse(claim.verification.verifiedAt))) failures.push("Verified claim " + claim.id + " lacks an explicit verification timestamp");
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Proof registry check passed: " + manifest.claims.length + " claims, " + manifest.claims.reduce((total, claim) => total + claim.evidence.length, 0) + " evidence links, provenance " + manifest.provenance.status + ".");
