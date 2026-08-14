import { afterEach, describe, expect, it } from "vitest";
import { getProofManifest, proofClaims, proofStatusLabels } from "@/lib/proof";

const provenanceKeys = [
  "GITHUB_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "PROOF_EVIDENCE_SHA",
  "PROOF_EVIDENCE_RUN_URL",
  "PROOF_EVIDENCE_COMMAND",
  "PROOF_EVIDENCE_VERIFIED_AT",
  "PROOF_EVIDENCE_CONCLUSION",
] as const;
const originalEnvironment = Object.fromEntries(provenanceKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of provenanceKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("portfolio proof manifest", () => {
  it("labels claims by evidence maturity and exposes only safe build metadata", () => {
    const manifest = getProofManifest();
    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.build.commit).toBeTruthy();
    expect(manifest.claims.map((claim) => claim.id)).toEqual(proofClaims.map((claim) => claim.id));
    expect(manifest.provenance.currentBuildVerified).toBe(false);
    expect(manifest.claims.some((claim) => claim.status === "ci_verified")).toBe(false);
    expect(proofClaims.some((claim) => claim.status === "ci_verified")).toBe(true);
    expect(manifest.claims.some((claim) => claim.status === "planned")).toBe(true);
    expect(proofStatusLabels.ci_verified).toBe("CI verified");
    expect(manifest).not.toHaveProperty("password");
    expect(manifest).not.toHaveProperty("secret");
    expect(Object.keys(manifest.build)).toEqual(["commit", "environment", "deploymentMode", "providerMode", "databaseMode", "buildTime", "evidenceVersion"]);
    expect(manifest.build.deploymentMode).toBe("local");
    expect(manifest.build.providerMode).toBe("mock");
  });

  it("promotes CI claims only when successful provenance matches the current build", () => {
    const sha = "319504b10ed652ed042e2932c533c2de41dec675";
    const verifiedAt = "2026-08-14T02:33:28.000Z";
    process.env.GITHUB_SHA = sha;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.PROOF_EVIDENCE_SHA = sha;
    process.env.PROOF_EVIDENCE_RUN_URL = "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/actions/runs/31764092580";
    process.env.PROOF_EVIDENCE_COMMAND = "quality + e2e";
    process.env.PROOF_EVIDENCE_VERIFIED_AT = verifiedAt;
    process.env.PROOF_EVIDENCE_CONCLUSION = "success";

    const manifest = getProofManifest();
    const verifiedClaims = manifest.claims.filter((claim) => claim.status === "ci_verified");
    expect(manifest.provenance.currentBuildVerified).toBe(true);
    expect(verifiedClaims).toHaveLength(proofClaims.filter((claim) => claim.status === "ci_verified").length);
    for (const claim of verifiedClaims) {
      expect(claim.lastVerifiedCommit).toBe(sha);
      expect(claim.verification).toMatchObject({
        commitSha: sha,
        conclusion: "success",
        verifiedAt,
      });
    }
  });

  it("does not synthesize verification for stale or incomplete evidence", () => {
    process.env.GITHUB_SHA = "319504b10ed652ed042e2932c533c2de41dec675";
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.PROOF_EVIDENCE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.PROOF_EVIDENCE_RUN_URL = "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/actions/runs/1";
    process.env.PROOF_EVIDENCE_CONCLUSION = "success";
    delete process.env.PROOF_EVIDENCE_VERIFIED_AT;

    const manifest = getProofManifest();
    expect(manifest.provenance.currentBuildVerified).toBe(false);
    expect(manifest.provenance.reason).toContain("different commit");
    expect(manifest.claims.every((claim) => claim.verification === undefined)).toBe(true);
  });
});
