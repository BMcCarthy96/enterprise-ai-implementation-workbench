# Recruiter walkthrough (90 seconds)

Use the public landing page first, then launch a private demo workspace. Keep the narration focused on the engineering decisions and the evidence they produce.

1. **Thesis (0:00–0:08).** “This is an Enterprise AI Implementation Workbench. AI drafts delivery work, but it never creates a task or sends a customer update without a human decision.” Launch **Start 90-second tour**; the workspace is synthetic, isolated, and expiring.
2. **Portfolio health (0:08–0:20).** On the dashboard, point out active projects, approval aging, blocked work, failed jobs, and progress. “These are tenant-scoped signals, not invented trend lines.”
3. **Grounded plan (0:20–0:32).** Open Order Intake Automation’s plan. Point out requirement coverage and `S1` citations. “Retrieval is filtered to this tenant and project before generation.”
4. **Inspectable evidence (0:32–0:46).** Open the repaired evidence packet. Show the synthetic-origin badge, initial schema failure, one repair, normalized checks, coverage, latency, linked artifact, and manager decision. The fixture is deliberately **Not priced**; provider cost appears only when a versioned live-provider price is available.
5. **Human checkpoint (0:46–0:58).** Open Approvals and show Claims Status Tracker waiting for review. “Before this transaction boundary, no milestones or tasks exist.”
6. **Failure and communication (0:58–1:10).** Show the seeded dead-letter job and the published-versus-pending customer updates. “Failure and communication both have explicit recoverable states.”
7. **Role-switch proof (1:10–1:22).** Switch from manager to customer, then Operations Admin. Point out that navigation and API permissions change because the session identity changes. “These are real synthetic memberships exercising the same RBAC matrix.”
8. **Evidence close (1:22–1:30).** Return to `/proof`. “Claims are separated into current-SHA CI evidence, implemented foundations, targets, and planned work; the architecture trail and source links are inspectable.”

## Five-minute technical extension

Use this only when the reviewer wants to see state change rather than the seeded 90-second story:

1. Switch to **Solutions Engineer**, open Patient Onboarding requirements, and generate a plan.
2. Switch to **Implementation Manager**, approve the resulting artifact, and confirm that delivery tasks materialize only after the decision.
3. Retry the dead-letter job in Operations and inspect its updated attempt state.
4. Switch to **Customer Stakeholder** to confirm that internal review detail is absent from the timeline.
5. Switch to **Operations Admin** and open Settings for OIDC, SCIM, webhooks, retention, and the read-only API explorer.

## Repeatable capture

```bash
docker compose up -d
npm run db:migrate
npm run db:seed
npm run dev
# in another terminal
npm run worker
```

Capture at 1440×900 with reduced motion enabled. Use the landing page’s **Start 90-second tour** action; the capture scripts provision the same isolated public flow and do not use the shared local seed credentials. The guided walkthrough opens once and can be minimized or restarted from its docked control. Use the persistent persona bar for the manager → customer → admin proof, and use **Reset** when you need a fresh scenario. Never record a real customer file or a long-lived credential.

For a repeatable silent capture, start the app and run:

```bash
npm run capture:video
```

The WebM is written under `artifacts/evidence/` (ignored by Git) so it can be trimmed or narrated separately without committing generated media.
