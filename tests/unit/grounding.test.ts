import { describe, expect, it } from "vitest";
import { mockEmbedding } from "@/lib/ai/embeddings";
import { redactSensitiveText } from "@/lib/ai/redaction";
import { chunkDocumentSections } from "@/server/services/documentIngestion";
import { validatePlanGuardrails } from "@/server/services/planGuardrails";
import type { PlanPromptInput } from "@/lib/ai/prompts";
import type { PlanContent } from "@/lib/ai/planSchema";

const requirementId = "10000000-0000-4000-8000-000000000001";
const input: PlanPromptInput = {
  projectName: "Grounded rollout",
  projectDescription: "A pilot",
  customerName: "Example Co",
  customerIndustry: "Technology",
  targetDate: null,
  requirements: [{ id: requirementId, title: "Configure SSO", details: null, priority: "high" }],
  sources: [{ ref: "S1", documentName: "brief.md", pageNumber: null, heading: "Security", content: "SSO is required." }],
};

const plan: PlanContent = {
  summary: "A phased rollout that configures and validates the SSO requirement.",
  summarySourceRefs: ["S1"],
  assumptions: [],
  risks: [{ description: "Access may arrive late.", severity: "medium", mitigation: "Request access in kickoff.", sourceRefs: ["S1"] }],
  milestones: [
    {
      name: "Discovery",
      description: "Confirm access and scope.",
      durationWeeks: 1,
      sourceRefs: ["S1"],
      tasks: [{ title: "Configure SSO", description: "Set up the provider.", requirementIds: [requirementId], sourceRefs: ["S1"], suggestedRole: "solutions_engineer", estimateHours: 8 }],
    },
    {
      name: "Launch",
      description: "Validate and hand off.",
      durationWeeks: 1,
      tasks: [{ title: "Validate SSO", description: "Run acceptance tests.", requirementIds: [requirementId], sourceRefs: ["S1"], suggestedRole: "solutions_engineer", estimateHours: 8 }],
    },
  ],
  openQuestions: [],
};

describe("grounding primitives", () => {
  it("redacts direct identifiers while preserving counts", () => {
    const result = redactSensitiveText("Contact jane@example.com at +1 (212) 555-0199.");
    expect(result.text).not.toContain("jane@example.com");
    expect(result.counts.email).toBe(1);
    expect(result.counts.phone).toBe(1);
  });

  it("does not mistake ISO delivery dates for phone numbers", () => {
    const result = redactSensitiveText("Target launch: 2026-10-30");
    expect(result.text).toContain("2026-10-30");
    expect(result.counts.phone).toBe(0);
  });

  it("preserves structured customer field names while redacting labeled ids", () => {
    const result = redactSensitiveText(
      '{"customerName":"Brightlane","customerIndustry":"Health","customerId":"public-key","note":"account id 1234-ABCD"}',
    );
    expect(result.text).toContain('"customerName"');
    expect(result.text).toContain('"customerIndustry"');
    expect(result.text).toContain('"customerId"');
    expect(result.text).not.toContain("1234-ABCD");
    expect(result.counts.identifier).toBe(1);
  });

  it("creates deterministic normalized mock embeddings", () => {
    const first = mockEmbedding("same text");
    expect(first).toEqual(mockEmbedding("same text"));
    expect(first).toHaveLength(1024);
    expect(Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1, 4);
  });

  it("chunks sections with stable hashes", () => {
    const sections = [{ text: Array(900).fill("token").join(" "), heading: "Security" }];
    const chunks = chunkDocumentSections(sections);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].heading).toBe("Security");
    expect(chunks[0].contentHash).toHaveLength(64);
    expect(chunks[0].content.split(" ").slice(-100).join(" ")).toBe(chunks[1].content.split(" ").slice(0, 100).join(" "));
  });

  it("accepts valid requirement and citation references", () => {
    expect(() => validatePlanGuardrails(input, plan)).not.toThrow();
  });

  it("rejects fabricated citation references", () => {
    expect(() => validatePlanGuardrails(input, { ...plan, summarySourceRefs: ["S8"] })).toThrow(/UNKNOWN_CITATION_REFERENCE/);
  });

  it("rejects missing requirement coverage", () => {
    expect(() => validatePlanGuardrails(input, { ...plan, milestones: plan.milestones.map((milestone) => ({ ...milestone, tasks: milestone.tasks.map((task) => ({ ...task, requirementIds: [] })) })) })).toThrow(/REQUIREMENT_COVERAGE_FAILED|TASK_REQUIREMENT_REFERENCE_MISSING/);
  });
});
