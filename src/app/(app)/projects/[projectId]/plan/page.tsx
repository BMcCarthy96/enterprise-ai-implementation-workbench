import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PlanContentSchema } from "@/lib/ai/planSchema";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { JobRunnerButton } from "@/components/JobRunnerButton";

export const dynamic = "force-dynamic";

export default async function PlanPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = (await getSession())!;
  const canGenerate = can(session.role, "plans.generate");

  const plans = await db.query.plans.findMany({
    where: eq(schema.plans.projectId, projectId),
    orderBy: desc(schema.plans.version),
  });
  const latest = plans[0];

  const generateButton = canGenerate ? (
    <JobRunnerButton
      endpoint={`/api/v1/projects/${projectId}/plans/generate`}
      label={latest ? "Regenerate plan" : "Generate implementation plan"}
      busyLabel="Generating plan..."
    />
  ) : null;

  if (!latest) {
    return (
      <EmptyState
        title="No implementation plan yet"
        hint="Generate one from the captured requirements. The plan is drafted by AI, then reviewed and approved by an implementation manager before any tasks are created."
      >
        {generateButton}
      </EmptyState>
    );
  }

  const parsed = PlanContentSchema.safeParse(latest.content);
  const content = parsed.success ? parsed.data : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-900">
            Plan v{latest.version}
          </h2>
          <StatusBadge status={latest.status} />
          <span className="text-xs text-gray-400">
            {latest.model === "mock" ? "offline model" : latest.model} ·{" "}
            {latest.promptVersion}
          </span>
        </div>
        {generateButton}
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

      {content && (
        <div className="space-y-6">
          <div className="card p-5">
            <h3 className="mb-2 text-sm font-semibold text-gray-900">Summary</h3>
            <p className="text-sm leading-relaxed text-gray-600">
              {content.summary}
            </p>
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
                      <span className="text-xs text-gray-400">
                        ~{m.durationWeeks} wk
                      </span>
                    )}
                  </div>
                  <p className="mb-2 ml-7 text-xs text-gray-500">
                    {m.description}
                  </p>
                  <ul className="ml-7 space-y-1">
                    {m.tasks.map((t, j) => (
                      <li key={j} className="flex items-baseline gap-2 text-sm">
                        <span className="text-gray-300">•</span>
                        <span className="text-gray-700">{t.title}</span>
                        {t.estimateHours && (
                          <span className="text-xs text-gray-400">
                            {t.estimateHours}h
                          </span>
                        )}
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
