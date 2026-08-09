# Case study: Enterprise AI Implementation Workbench

Portfolio narrative — the story to tell in a case-study page, a Loom, and an interview.

## Context

Implementation teams repeatedly collect messy customer requirements, turn them into a scoped delivery plan, get that plan blessed, track execution, and keep stakeholders informed. A chatbot can draft prose quickly, but it cannot make the output trustworthy, auditable, or safe to execute.

The Workbench is the internal platform version of that loop: intake is structured, AI scoping is grounded and human-approved, delivery is materialized only after approval, and customer communication is generated from real delivery state.

## Users and stakes

Four personas have different powers: the admin owns the organization, the implementation manager approves what ships, the solutions engineer drafts and executes but cannot approve their own AI output, and the customer sees only an explicit allowlist of published progress. RBAC is the workflow, not a checkbox.

## Architecture in one breath

Next.js + REST over PostgreSQL/pgvector, private S3, SQS + DLQ, Bedrock Claude/Titan adapters, and a shared worker path that runs locally or behind an SQS-triggered Lambda. Retrieval is tenant- and project-filtered, source refs are persisted with plans, and AI Runs expose sanitized call traces without storing raw prompts. CDK captures the AWS shape; the deterministic mock keeps the full workflow runnable with zero cloud credentials.

## Hardest tradeoff

Trust is enforced in layers with different jobs: the prompt constrains format and treats input as data; Zod rejects malformed structure; requirement/citation guardrails reject fabricated references and injection echoes; redaction limits unnecessary identifiers; and the human gate makes even valid output inert until approved. Schema validation verifies shape and provenance; the manager still verifies judgment, scope, sequencing, and tone.

## Designing for failure

- At-least-once SQS delivery is handled with atomic database claims; duplicate messages are expected and harmless.
- Application failures use persisted exponential backoff and dead-letter parking; infrastructure-level Lambda failures use partial-batch responses.
- A model response gets at most one repair call. If the repaired output still fails schema or guardrails, no plan is persisted.
- Document ingestion is idempotent: content hashes replace chunks safely, unsupported or malformed files become visible failed states, and embedding calls are traceable without storing source text in telemetry.
- The public demo reserves quota and estimated spend before a model call; exhausted limits return a typed response without starting generation.

## Measured evidence

- The committed offline fixture suite covers 15 synthetic cases × 3 prompt variants, including retrieval-on/retrieval-off pairs: 100% schema validity, requirement coverage, and citation/injection gates, with a hard regression check.
- Every generated plan carries `model` and `promptVersion`; every AI run carries provider/model, usage source, versioned pricing, latency, repair outcome, and sanitized error classification.
- The AI Runs surface makes retrieval, generation, repair, guardrails, and citations inspectable. Raw production prompts and document chunks are intentionally excluded.
- The optional LLM judge emits a schema-validated five-point score for clarity, actionability, business tone, and scope discipline; calibration keeps it advisory unless the 15-output Spearman/MAE thresholds are met.
- The seed data includes a rejected plan, a repaired approved plan, a pending approval queue, a grounded source document, a dead-letter job, and a second tenant for isolation checks.

## What I would do next

1. Complete the guided Neon/AWS account setup and deploy the synthesized CDK stack with Vercel OIDC.
2. Run the 15-output human calibration and enable an LLM judge only if the correlation and MAE thresholds are met.
3. Run retrieval-on/retrieval-off live comparisons and a production smoke test against the Lambda path.
4. Keep OCR, real customer data, enterprise SSO, and statistically conclusive experimentation explicitly out of scope until the evidence supports them.
