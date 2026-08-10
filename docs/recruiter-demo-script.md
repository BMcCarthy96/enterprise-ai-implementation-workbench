# Recruiter walkthrough (90 seconds)

Use the public landing page first, then launch a private demo workspace. Keep the narration focused on the engineering decisions and the evidence they produce.

1. **Thesis (0:00–0:10).** “This is an Enterprise AI Implementation Workbench. AI drafts delivery work, but it never creates a task or sends a customer update without a human decision.” The isolated demo opens **Recruiter Mode** once with a role-aware checklist and a persistent persona bar.
2. **Portfolio health (0:10–0:22).** Start on the polished dashboard. Point out active projects, approval aging, blocked work, failed jobs, and the project progress bars. “These are live tenant-scoped signals, not invented trend lines.”
3. **Grounded generation (0:22–0:38).** Follow the checklist to Order Intake Automation’s Plan tab. Point out `S1` citations and the document metadata. “The model receives only project-scoped retrieved chunks, with direct identifiers redacted.”
4. **Inspectable evidence (0:38–0:52).** Open the repaired AI evidence packet. Walk the timeline: initial schema failure, normalized failure code, one repair, hard-gate/quality-signal checks, requirement/citation coverage, latency, cost, linked artifact, and manager decision. “The system proves what it checked without retaining raw prompts, source text, or model output.”
5. **Human checkpoint (0:52–1:06).** Open Approvals and show the Claims Status Tracker plan waiting for a manager decision. “Approval is a transaction boundary: before this decision, no milestones or tasks exist.”
6. **Live delivery loop (1:06–1:22).** Open Patient Onboarding requirements, generate a plan, approve it, and return to the board. The checklist updates as the plan and tasks appear. Then show the dead-letter job and the published/pending customer updates.
7. **Role-switch proof (1:22–1:38).** Use the persistent bar to switch to Solutions Engineer, then Customer Stakeholder, then Operations Admin. Point out that the URL stays inside the same isolated workspace while navigation and API permissions change. “These are four real synthetic memberships exercising the same RBAC matrix — not a cosmetic role label.”
8. **Architecture close (1:38–1:46).** Return to the landing page architecture card. “The local stack is Docker + LocalStack + pgvector. CDK synthesizes private S3, SQS/DLQ, Lambda partial-batch handling, alarms, budgets, and an optional Vercel OIDC role.”

## Repeatable capture

```bash
docker compose up -d
npm run db:migrate
npm run db:seed
npm run dev
# in another terminal
npm run worker
```

Capture at 1440×900 with reduced motion enabled. Use the landing page’s **Launch interactive demo** action for the isolated public flow; Recruiter Mode will open once and can be minimized or restarted from its docked control. Use the persistent persona bar for the engineer → customer → admin proof, and use **Reset** when you need a fresh scenario. Never record a real customer file or a long-lived credential.

For a repeatable silent capture, start the app and run:

```bash
npm run capture:video
```

The WebM is written under `artifacts/evidence/` (ignored by Git) so it can be trimmed or narrated separately without committing generated media.
