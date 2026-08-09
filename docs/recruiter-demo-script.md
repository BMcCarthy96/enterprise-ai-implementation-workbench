# Recruiter walkthrough (90 seconds)

Use the public landing page first, then launch a private demo workspace. Keep the narration focused on the engineering decisions and the evidence they produce.

1. **Thesis (0:00–0:12).** “This is an Enterprise AI Implementation Workbench. AI drafts delivery work, but it never creates a task or sends a customer update without a human decision.”
2. **Grounded generation (0:12–0:30).** Open a project’s Documents tab, show the synthetic brief, then the Plan tab. Point out `S1` citations and the document/page metadata. “The model receives only project-scoped retrieved chunks, with direct identifiers redacted.”
3. **Inspectable trace (0:30–0:48).** Open **View generation trace**. Walk the timeline: retrieval embedding, initial generation, schema failure, one repair, and the final outcome. “Usage is labeled reported or estimated and cost comes from a versioned catalog.”
4. **Human checkpoint (0:48–1:05).** Open Approvals, reject or approve the pending plan. “Approval is a transaction boundary: before this decision, no milestones or tasks exist. Rejection reason and feedback are carried into the next generation.”
5. **Quality evidence (1:05–1:18).** Open Insights, then AI Runs. “The offline fixture suite is committed, the prompt variants are versioned, and the dashboard reports first-pass validity, repair rescue, cost, p50/p95 latency, and guardrail failures.”
6. **Architecture close (1:18–1:30).** Return to the landing page architecture card. “The local stack is Docker + LocalStack + pgvector. CDK synthesizes private S3, SQS/DLQ, Lambda partial-batch handling, alarms, budgets, and an optional Vercel OIDC role.”

## Repeatable capture

```bash
docker compose up -d
npm run db:migrate
npm run db:seed
npm run dev
# in another terminal
npm run worker
```

Capture at 1440×900 with reduced motion enabled. Use the seeded Northwind account for the internal walkthrough and the landing page’s **Launch interactive demo** action for the isolated public flow. Never record a real customer file or a long-lived credential.

For a repeatable silent capture, start the app and run:

```bash
npm run capture:video
```

The WebM is written under `artifacts/evidence/` (ignored by Git) so it can be trimmed or narrated separately without committing generated media.
