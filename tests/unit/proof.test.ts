import { describe, expect, it } from "vitest";
import { getProofManifest, proofClaims, proofStatusLabels } from "@/lib/proof";

describe("portfolio proof manifest", () => {
  it("labels claims by evidence maturity and exposes only safe build metadata", () => {
    const manifest = getProofManifest();
    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.build.commit).toBeTruthy();
    expect(manifest.claims.map((claim) => claim.id)).toEqual(proofClaims.map((claim) => claim.id));
    expect(manifest.claims.find((claim) => claim.status === "verified")?.lastVerifiedCommit).toBe(manifest.build.commit);
    expect(manifest.claims.some((claim) => claim.status === "planned")).toBe(true);
    expect(proofStatusLabels.verified).toContain("Verified");
    expect(manifest).not.toHaveProperty("password");
    expect(manifest).not.toHaveProperty("secret");
    expect(Object.keys(manifest.build)).toEqual(["commit", "environment"]);
  });
});
