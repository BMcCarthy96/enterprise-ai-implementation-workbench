# Case study: Enterprise AI Implementation Workbench

Portfolio narrative — the story to tell on a case-study page, in a Loom, and in interviews. (Structure follows: context → constraints → architecture → hardest tradeoff → failure handling → what changed → what's next.)

## Context

Implementation teams (agencies, onboarding teams, solutions orgs) run the same loop for every customer: collect messy requirements from calls and email threads, turn them into a scoped plan, get it blessed, track delivery, and keep the customer informed. Each step is manual, slow, and inconsistent — and the "AI fix" most teams try (paste notes into a chatbot) produces plans nobody can trust or track.

The Workbench is the internal platform version of that loop: intake is structured, scoping is AI-drafted but human-approved, delivery is tracked against the approved plan, and customer communication is generated from real delivery state — with an audit trail across all of it.

## Users and stakes

Four personas with genuinely different needs: the **admin** needs control and visibility, the **manager** is accountable for what ships and what the customer reads, the **engineer** needs speed without approval authority, and the **customer** needs status without internal noise. RBAC isn't a feature checkbox here — the entire workflow is the permission model (the person who generates a plan cannot be the person who approves it).

## Why AI was appropriate — and where it wasn't

AI is good at exactly one step of this loop: transforming unstructured requirements into a structured draft plan, and summarizing activity into prose. Everything else — what happens when a plan is approved, who may decide, how retries work, what the customer sees — is deterministic code. Drawing that line early simplified the whole system: model calls are free to fail or be re-run because they never mutate delivery state; only the (idempotent-guarded) human approval transaction does.

## Architecture in one breath

Next.js app + REST API over Postgres, with S3 for documents, SQS for async jobs, and Bedrock (Claude) for generation; a separate worker long-polls the queue, validates model output against a zod schema with one repair retry, and everything runs locally against LocalStack with a deterministic mock provider — so the demo needs zero cloud credentials and the AWS deployment is an env-var change.

## Hardest tradeoff

**Where to enforce trust in model output.** Three candidate layers: prompt (ask nicely), schema (validate), or human (review). The answer was all three with different jobs: the prompt constrains format *cheaply*, the zod schema makes malformed output *impossible to persist* (with one repair round-trip feeding errors back), and the human gate makes even valid output *inert until approved*. The insight worth defending in interviews: schema validation is not a substitute for human review — it verifies *shape*, while the manager verifies *judgment* (sequencing, scope, tone).

## Designing for failure

- At-least-once SQS delivery handled with atomic DB job claims (duplicates no-op).
- Exponential backoff (5s→10s→20s, capped) with attempts persisted; exhausted jobs park as dead-letter with a manual, audited retry button.
- The seed data ships a throttled dead-letter job on purpose, so the failure story is demoable, not hypothetical.
- A unit test simulating prompt-envelope smuggling (`</input_json>` inside user text) caught a real extraction bug during development; the fix and the test shipped together.

## Measurable framing

- Plan drafting: ~hours of manual scoping → a reviewed draft in under a minute of wall-clock (one job round-trip).
- Every generated plan carries `model` + `promptVersion`, so approval/rejection rates per prompt version are queryable from day one — the eval loop is built into the data model.
- Approval turnaround, retry counts, job durations, and rejection reason codes are all first-class columns, not log archaeology.

## What I'd build next

1. Postgres RLS as a second tenancy enforcement layer.
2. Structured plan-version diffs to speed re-approval.
3. Rejection-reason analytics per prompt version (the closing of the quality loop).
4. SSE for job status instead of polling.
