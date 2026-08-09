import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema, withTenantTransaction } from "@/db";
import { PageHeader } from "@/components/PageHeader";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const outcomeTone: Record<string, string> = {
  succeeded: "text-emerald-700 bg-emerald-50",
  running: "text-indigo-700 bg-indigo-50",
  failed: "text-red-700 bg-red-50",
  repaired: "text-amber-700 bg-amber-50",
  blocked: "text-red-700 bg-red-50",
};

export default async function AiRunsPage() {
  const session = (await getSession())!;
  if (!can(session.role, "audit.view")) redirect("/dashboard");
  return withTenantTransaction(session.orgId, async () => {
    const runs = await db.query.aiRuns.findMany({
      where: eq(schema.aiRuns.orgId, session.orgId),
      orderBy: desc(schema.aiRuns.createdAt),
      limit: 100,
    });
    return (
    <div>
      <PageHeader
        title="AI Runs"
        subtitle="Inspectable traces for generation, retrieval, validation, repair, and cost."
      />
      <div className="card overflow-hidden">
        <div className="border-b border-gray-100 bg-slate-50 px-5 py-3 text-xs text-gray-500">
          Raw prompts and document content are intentionally excluded from telemetry.
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-5 py-3">Run</th>
                <th className="px-5 py-3">Artifact</th>
                <th className="px-5 py-3">Provider / prompt</th>
                <th className="px-5 py-3 text-right">Latency</th>
                <th className="px-5 py-3 text-right">Cost</th>
                <th className="px-5 py-3">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link href={`/ai-runs/${run.id}`} className="font-mono text-xs text-indigo-700 hover:underline">
                      {run.id.slice(0, 8)}
                    </Link>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {run.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </td>
                  <td className="px-5 py-3 capitalize text-gray-700">{run.artifactType.replace("_", " ")}</td>
                  <td className="px-5 py-3">
                    <p className="text-gray-700">{run.provider}</p>
                    <p className="font-mono text-[11px] text-gray-400">{run.promptVersion ?? "—"}</p>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-700">
                    {run.latencyMs == null ? "—" : `${(run.latencyMs / 1000).toFixed(1)}s`}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-700">
                    {run.costUsd == null ? "—" : `$${Number(run.costUsd).toFixed(4)}`}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`badge ${outcomeTone[run.finalOutcome ?? run.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {run.finalOutcome ?? run.status}
                    </span>
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-400">No AI runs yet. Generate a plan to create the first trace.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    );
  }, session.userId);
}
