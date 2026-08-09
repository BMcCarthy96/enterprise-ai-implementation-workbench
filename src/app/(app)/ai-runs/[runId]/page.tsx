import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, schema, withTenantTransaction } from "@/db";
import { PageHeader } from "@/components/PageHeader";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { uuidParam } from "@/server/services/access";

export const dynamic = "force-dynamic";

export default async function AiRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "audit.view")) redirect("/dashboard");
  const runId = uuidParam((await params).runId, "runId");
  return withTenantTransaction(session.orgId, async () => {
    const run = await db.query.aiRuns.findFirst({
      where: and(eq(schema.aiRuns.id, runId), eq(schema.aiRuns.orgId, session.orgId)),
    });
    if (!run) notFound();
    const calls = await db.query.aiCalls.findMany({
      where: eq(schema.aiCalls.aiRunId, run.id),
      orderBy: asc(schema.aiCalls.sequence),
    });
    const plan = run.jobId
      ? await db.query.plans.findFirst({
          where: and(eq(schema.plans.orgId, session.orgId), eq(schema.plans.generatedByJobId, run.jobId)),
        })
      : null;
    const citations = plan
      ? await db.query.planCitations.findMany({ where: eq(schema.planCitations.planId, plan.id) })
      : [];
    return (
    <div>
      <PageHeader
        title="AI run trace"
        subtitle={`${run.artifactType.replace("_", " ")} · ${run.provider} · ${run.promptVersion ?? "unversioned"}`}
        actions={<Link href="/ai-runs" className="btn-secondary">Back to AI runs</Link>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[
          ["Status", run.finalOutcome ?? run.status],
          ["Latency", run.latencyMs == null ? "—" : `${(run.latencyMs / 1000).toFixed(1)}s`],
          ["Input tokens", `${run.inputTokens}`],
          ["Output tokens", `${run.outputTokens}`],
          ["Redactions", `${run.redactionCount}`],
          ["Cost", run.costUsd == null ? "—" : `$${Number(run.costUsd).toFixed(4)}`],
        ].map(([label, value]) => (
          <div key={label} className="card p-4"><p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p><p className="mt-1 text-lg font-semibold text-slate-900">{value}</p></div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900">Execution timeline</h2>
          <ol className="mt-4 space-y-4">
            {calls.map((call) => (
              <li key={call.id} className="relative pl-8">
                <span className={`absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${call.outcome === "valid" ? "bg-emerald-100 text-emerald-700" : call.outcome === "failed" || call.outcome === "blocked" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{call.sequence}</span>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium capitalize text-gray-800">{call.operation} · {call.outcome}</p>
                  <p className="text-xs tabular-nums text-gray-400">{call.latencyMs ?? 0}ms</p>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">{call.provider} / {call.model ?? "unknown model"} · {call.inputTokens} in / {call.outputTokens} out · usage {call.usageSource}{call.redactionCount ? ` · ${call.redactionCount} redacted` : ""}</p>
                {call.errorKind && <p className="mt-1 text-xs text-red-600">Classified error: {call.errorKind}</p>}
              </li>
            ))}
          </ol>
        </div>
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900">Grounding evidence</h2>
          <p className="mt-1 text-xs text-gray-500">Only normalized citation metadata is shown in the trace.</p>
          {citations.length ? (
            <ul className="mt-4 space-y-2">
              {citations.map((citation) => <li key={citation.id} className="rounded-md border border-gray-100 bg-slate-50 px-3 py-2 text-xs"><span className="font-mono font-semibold text-indigo-700">{citation.sourceRef}</span><span className="ml-2 text-gray-600">{citation.location ?? "document chunk"}</span></li>)}
            </ul>
          ) : <p className="mt-4 text-sm text-gray-400">No document citations on this run.</p>}
        </div>
      </div>
      </div>
    );
  }, session.userId);
}
