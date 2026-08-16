import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema, withTenantTransaction } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PlanContentSchema } from "@/lib/ai/planSchema";
import { diffPlans } from "@/lib/ai/planDiff";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { JobRunnerButton } from "@/components/JobRunnerButton";
import { TOUR_TARGETS } from "@/lib/tour";

export const dynamic = "force-dynamic";

export default async function PlanPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = (await getSession())!;
  if (!can(session.role, "internal.view")) redirect(`/projects/${projectId}`);
  const canGenerate = can(session.role, "plans.generate");

  const { plans, trace, citations } = await withTenantTransaction(
    session.orgId,
    async () => {
      const plans = await db.query.plans.findMany({
        where: eq(schema.plans.projectId, projectId),
        orderBy: desc(schema.plans.version),
      });
      const latest = plans[0];
      const trace = latest?.generatedByJobId && can(session.role, "audit.view")
        ? await db.query.aiRuns.findFirst({
            where: and(
              eq(schema.aiRuns.orgId, session.orgId),
              eq(schema.aiRuns.jobId, latest.generatedByJobId),
            ),
          })
        : null;
      const citations = latest
        ? (await db.execute(sql`
            SELECT pc.source_ref AS "sourceRef", d.file_name AS "fileName",
                   dc.page_number AS "pageNumber", dc.heading AS heading
            FROM plan_citations pc
            INNER JOIN document_chunks dc ON dc.id = pc.chunk_id
            INNER JOIN documents d ON d.id = dc.document_id
            WHERE pc.plan_id = ${latest.id} AND pc.org_id = ${session.orgId}
            ORDER BY pc.source_ref
          `)) as unknown as Array<{
            sourceRef: string;
            fileName: string;
            pageNumber: number | null;
            heading: string | null;
          }>
        : [];
      return { plans, trace, citations };
    },
    session.userId,
  );
  const latest = plans[0];

  const generateButton = canGenerate ? (
    <div className="scroll-mt-28" data-tour-target={TOUR_TARGETS.projectPlanGenerate}>
      <JobRunnerButton
        endpoint={`/api/v1/projects/${projectId}/plans/generate`}
        label={latest ? "Regenerate plan" : "Generate implementation plan"}
        busyLabel="Generating plan..."
      />
    </div>
  ) : null;

  if (!latest) {
    return (
      <div className="scroll-mt-28" data-tour-target={TOUR_TARGETS.projectPlan} aria-label="Implementation plan">
        <EmptyState
          title="No implementation plan yet"
          hint="Generate one from the captured requirements. The plan is drafted by AI, then reviewed and approved by an implementation manager before any tasks are created."
        >
          {generateButton}
          {trace && (
            <Link href={`/ai-runs/${trace.id}`} className="btn-secondary">
              Inspect AI evidence packet
            </Link>
          )}
        </EmptyState>
      </div>
    );
  }

  const parsed = PlanContentSchema.safeParse(latest.content);
  const content = parsed.success ? parsed.data : null;

  // Diff against the immediately prior version (if any) so re-approval is fast.
  const prev = plans[1];
  const prevParsed = prev ? PlanContentSchema.safeParse(prev.content) : null;
  const diff =
    content && prevParsed?.success
      ? diffPlans(prevParsed.data, content)
      : null;

  return (
    <div className="scroll-mt-28" data-tour-target={TOUR_TARGETS.projectPlan} aria-label="Implementation plan">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-gray-900">
            Plan v{latest.version}
          </h2>
          <StatusBadge status={latest.status} />
          <span className="text-xs text-gray-500">
            {latest.model === "mock" ? "offline model" : latest.model} · {latest.promptVersion}
          </span>
          {trace && <span className={`badge border ${trace.dataOrigin === "fixture" ? "border-slate-200 bg-slate-50 text-slate-600" : trace.dataOrigin === "mock_run" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{trace.dataOrigin === "fixture" ? "Synthetic scenario" : trace.dataOrigin === "mock_run" ? "Deterministic mock run" : "Live provider run"}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {trace && can(session.role, "audit.view") && <Link href={`/ai-runs/${trace.id}`} className="btn-secondary">Inspect AI evidence packet</Link>}
          {generateButton}
        </div>
      </div>

      {latest.status === "pending_approval" && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This plan is awaiting review. Milestones and tasks are only created
          once an implementation manager approves it in the Approvals queue.
        </div>
      )}
      {latest.status === "rejected" && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          This plan version was rejected. Adjust the requirements and
          regenerate, or review the rejection reason in the audit log.
        </div>
      )}

      {latest.incorporatedFeedback && (
        <div className="mb-4 rounded-md border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
          <span className="font-medium">Revised from reviewer feedback:</span>{" "}
          {latest.incorporatedFeedback}
        </div>
      )}

      {diff && diff.hasChanges && (
        <div className="mb-4 card p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">
            Changes from v{prev!.version}
          </h3>
          <ul className="space-y-1 text-sm text-gray-600">
            {diff.milestonesAdded.map((m) => (
              <li key={`a-${m}`} className="text-emerald-700">
                + Milestone added: {m}
              </li>
            ))}
            {diff.milestonesRemoved.map((m) => (
              <li key={`r-${m}`} className="text-red-700">
                − Milestone removed: {m}
              </li>
            ))}
            {diff.taskCountDelta !== 0 && (
              <li>
                Tasks {diff.taskCountDelta > 0 ? "increased" : "decreased"} by{" "}
                {Math.abs(diff.taskCountDelta)} ({diff.previousTaskCount} →{" "}
                {diff.currentTaskCount})
              </li>
            )}
            {diff.riskCountDelta !== 0 && (
              <li>
                Risks {diff.riskCountDelta > 0 ? "+" : ""}
                {diff.riskCountDelta}
              </li>
            )}
            {diff.summaryChanged && <li>Summary was revised</li>}
          </ul>
        </div>
      )}

      {content && (
        <div className="space-y-6">
          <div className="card p-5">
            <h3 className="mb-2 text-sm font-semibold text-gray-900">Summary</h3>
            <p className="text-sm leading-relaxed text-gray-600">
              {content.summary}
            </p>
            {content.summarySourceRefs?.length ? (
              <p className="mt-3 text-xs text-indigo-700">
                Sources: {content.summarySourceRefs.join(", ")}
              </p>
            ) : null}
          </div>

          <div className="card">
            <div className="border-b border-gray-100 px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">
                Milestones & tasks
              </h3>
            </div>
            <div className="divide-y divide-gray-100">
              {content.milestones.map((m, i) => (
                <div key={i} className="px-4 py-4">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                      {i + 1}
                    </span>
                    <p className="text-sm font-medium text-gray-900">{m.name}</p>
                    {m.durationWeeks && (
                      <span className="text-xs text-gray-500">
                        ~{m.durationWeeks} wk
                      </span>
                    )}
                  </div>
                  <p className="mb-2 ml-7 text-xs text-gray-500">
                    {m.description}
                  </p>
                  {m.sourceRefs?.length ? <p className="mb-2 ml-7 font-mono text-[11px] text-indigo-600">Sources: {m.sourceRefs.join(", ")}</p> : null}
                  <ul className="ml-7 space-y-1">
                    {m.tasks.map((t, j) => (
                      <li key={j} className="flex items-baseline gap-2 text-sm">
                        <span className="text-gray-300">•</span>
                        <span className="text-gray-700">{t.title}</span>
                        {t.estimateHours && (
                          <span className="text-xs text-gray-500">
                            {t.estimateHours}h
                          </span>
                        )}
                        {t.sourceRefs?.length ? <span className="font-mono text-[11px] text-indigo-600">[{t.sourceRefs.join(", ")}]</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card p-5">
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Risks</h3>
              {content.risks.length === 0 ? (
                <p className="text-sm text-gray-500">No risks identified.</p>
              ) : (
                <ul className="space-y-2">
                  {content.risks.map((r, i) => (
                    <li key={i} className="text-sm">
                      <div className="flex items-start gap-2">
                        <StatusBadge status={r.severity} />
                        <div>
                          <p className="text-gray-700">{r.description}</p>
                          {r.mitigation && (
                            <p className="mt-0.5 text-xs text-gray-500">
                              Mitigation: {r.mitigation}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-6">
              <div className="card p-5">
                <h3 className="mb-2 text-sm font-semibold text-gray-900">
                  Assumptions
                </h3>
                <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
                  {content.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
              <div className="card p-5">
                <h3 className="mb-2 text-sm font-semibold text-gray-900">
                  Open questions
                </h3>
                <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
                  {content.openQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {citations.length > 0 && (
        <div className="mt-6 card scroll-mt-28 p-5" data-tour-target={TOUR_TARGETS.projectPlanCitations}>
          <h3 className="text-sm font-semibold text-gray-900">Grounding sources</h3>
          <p className="mt-1 text-xs text-gray-500">The model was given these project-scoped excerpts; source refs are validated before approval.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {citations.map((citation) => (
              <li key={citation.sourceRef} className="rounded-md border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-xs">
                <span className="font-mono font-semibold text-indigo-700">{citation.sourceRef}</span>
                <span className="ml-2 text-gray-700">{citation.fileName}</span>
                <span className="ml-2 text-gray-500">{citation.pageNumber ? `page ${citation.pageNumber}` : citation.heading ?? "document excerpt"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plans.length > 1 && (
        <div className="mt-6 card">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">
              Version history
            </h3>
          </div>
          <ul className="divide-y divide-gray-100">
            {plans.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <span className="text-gray-700">
                  v{p.version} ·{" "}
                  {p.createdAt.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
