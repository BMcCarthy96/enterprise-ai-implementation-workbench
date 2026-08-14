import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema, withTenantTransaction } from "@/db";
import { PageHeader } from "@/components/PageHeader";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { summarizeEvidence } from "@/server/services/aiEvidence";

export const dynamic = "force-dynamic";

const outcomeTone: Record<string, string> = {
  succeeded: "text-emerald-700 bg-emerald-50",
  running: "text-indigo-700 bg-indigo-50",
  failed: "text-red-700 bg-red-50",
  repaired: "text-amber-700 bg-amber-50",
  blocked: "text-red-700 bg-red-50",
};

export default async function AiRunsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "audit.view")) redirect("/dashboard");
  const search = (await searchParams) ?? {};
  const artifactFilter = typeof search.artifact === "string" ? search.artifact : "";
  const outcomeFilter = typeof search.outcome === "string" ? search.outcome : "";
  const promptFilter = typeof search.promptVersion === "string" ? search.promptVersion : "";
  return withTenantTransaction(session.orgId, async () => {
    const allRuns = await db.query.aiRuns.findMany({
      where: eq(schema.aiRuns.orgId, session.orgId),
      orderBy: desc(schema.aiRuns.createdAt),
      limit: 100,
    });
    const runs = allRuns.filter((run) => (!artifactFilter || run.artifactType === artifactFilter) && (!outcomeFilter || (run.finalOutcome ?? run.status) === outcomeFilter) && (!promptFilter || (run.promptVersion ?? "") === promptFilter));
    const evaluations = runs.length
      ? await db.query.aiRunEvaluations.findMany({ where: eq(schema.aiRunEvaluations.orgId, session.orgId) })
      : [];
    const summaries = new Map(runs.map((run) => [run.id, summarizeEvidence(evaluations.filter((evaluation) => evaluation.aiRunId === run.id))]));
    const checkedRuns = runs.filter((run) => (summaries.get(run.id)?.total ?? 0) > 0).length;
    const passingRuns = runs.filter((run) => summaries.get(run.id)?.hardGatePassed === true).length;
    const repairRuns = runs.filter((run) => run.finalOutcome === "repaired").length;
    return (
      <div>
        <PageHeader
          title="AI Evidence Center"
          subtitle="Trace model activity, normalized quality checks, grounding, artifacts, and human decisions."
        />
        <form method="get" className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="Filter AI evidence">
          <label className="text-xs font-semibold text-slate-600">Artifact<select name="artifact" defaultValue={artifactFilter} className="mt-1 block rounded-md border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-800"><option value="">All artifacts</option><option value="plan">Plan</option><option value="customer_update">Customer update</option><option value="document_ingest">Document ingest</option><option value="eval">Eval</option></select></label>
          <label className="text-xs font-semibold text-slate-600">Outcome<select name="outcome" defaultValue={outcomeFilter} className="mt-1 block rounded-md border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-800"><option value="">All outcomes</option>{[...new Set(allRuns.map((run) => run.finalOutcome ?? run.status))].map((outcome) => <option key={outcome} value={outcome}>{outcome}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">Prompt version<select name="promptVersion" defaultValue={promptFilter} className="mt-1 block rounded-md border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-800"><option value="">All prompt versions</option>{[...new Set(allRuns.map((run) => run.promptVersion).filter(Boolean))].map((prompt) => <option key={prompt} value={prompt!}>{prompt}</option>)}</select></label>
          <button type="submit" className="btn-secondary text-xs">Apply filters</button>
          {(artifactFilter || outcomeFilter || promptFilter) && <Link href="/ai-runs" className="text-xs font-semibold text-indigo-700 hover:underline">Clear</Link>}
        </form>
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="card p-4"><p className="text-2xl font-semibold text-slate-900">{runs.length}</p><p className="mt-1 text-sm text-gray-500">Inspectable runs</p><p className="mt-0.5 text-xs text-gray-400">tenant-scoped traces</p></div>
          <div className="card p-4"><p className="text-2xl font-semibold text-emerald-700">{passingRuns}</p><p className="mt-1 text-sm text-gray-500">Hard-gate passes</p><p className="mt-0.5 text-xs text-gray-400">of {checkedRuns} evaluated runs</p></div>
          <div className="card p-4"><p className="text-2xl font-semibold text-amber-700">{repairRuns}</p><p className="mt-1 text-sm text-gray-500">Repair rescues</p><p className="mt-0.5 text-xs text-gray-400">invalid first pass → repair</p></div>
          <div className="card p-4"><p className="text-2xl font-semibold text-indigo-700">{runs.filter((run) => run.artifactType === "plan").length}</p><p className="mt-1 text-sm text-gray-500">Plan artifacts</p><p className="mt-0.5 text-xs text-gray-400">approval-linked where available</p></div>
        </div>
        <div className="card overflow-hidden">
          <div className="border-b border-gray-100 bg-slate-50 px-5 py-3 text-xs text-gray-500">Raw prompts and document content are intentionally excluded from telemetry. Open a run for normalized evidence and the artifact chain.</div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-400"><tr><th className="px-5 py-3">Run</th><th className="px-5 py-3">Artifact</th><th className="px-5 py-3">Provider / prompt</th><th className="px-5 py-3 text-right">Evidence</th><th className="px-5 py-3 text-right">Latency</th><th className="px-5 py-3 text-right">Cost</th><th className="px-5 py-3">Outcome</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {runs.map((run) => {
                  const summary = summaries.get(run.id);
                  return <tr key={run.id} className="hover:bg-slate-50"><td className="px-5 py-3"><Link href={`/ai-runs/${run.id}`} className="font-mono text-xs text-indigo-700 hover:underline">{run.id.slice(0, 8)}</Link><p className="mt-0.5 text-xs text-gray-400">{run.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p></td><td className="px-5 py-3 capitalize text-gray-700">{run.artifactType.replace("_", " ")}</td><td className="px-5 py-3"><p className="text-gray-700">{run.provider}</p><p className="font-mono text-[11px] text-gray-400">{run.promptVersion ?? "—"}</p></td><td className="px-5 py-3 text-right">{summary?.total ? <span className={`badge ${summary.hardGatePassed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{summary.passed}/{summary.total}</span> : <span className="text-xs text-gray-400">Legacy</span>}</td><td className="px-5 py-3 text-right tabular-nums text-gray-700">{run.latencyMs == null ? "—" : `${(run.latencyMs / 1000).toFixed(1)}s`}</td><td className="px-5 py-3 text-right tabular-nums text-gray-700">{run.costUsd == null ? (run.dataOrigin === "fixture" ? <span title="Synthetic fixture; provider spend was not measured">Not priced</span> : "—") : `$${Number(run.costUsd).toFixed(4)}`}</td><td className="px-5 py-3"><span className={`badge ${outcomeTone[run.finalOutcome ?? run.status] ?? "bg-gray-100 text-gray-600"}`}>{run.finalOutcome ?? run.status}</span></td></tr>;
                })}
                {runs.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-gray-400">No matching evidence yet. Generate a plan to create the first evidence packet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }, session.userId);
}
