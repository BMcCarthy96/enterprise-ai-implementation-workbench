import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { withTenantTransaction } from "@/db";
import { PageHeader } from "@/components/PageHeader";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { uuidParam } from "@/server/services/access";
import { getAiEvidencePacket, summarizeEvidence } from "@/server/services/aiEvidence";
import { TOUR_TARGETS } from "@/lib/tour";
import { CopyValueButton } from "@/components/CopyValueButton";

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
    const packet = await getAiEvidencePacket(session.orgId, runId);
    if (!packet) notFound();
    const evidence = summarizeEvidence(packet.evaluations);
    return (
      <div>
        <PageHeader
          title="AI evidence packet"
          subtitle={`${packet.run.artifactType.replace("_", " ")} · ${packet.run.provider} · ${packet.run.promptVersion ?? "unversioned"}`}
          actions={<div className="flex flex-wrap gap-2">{packet.artifact && <Link href={packet.artifact.href} className="btn-secondary">Open generated artifact</Link>}<Link href="/ai-runs" className="btn-secondary">Back to evidence center</Link></div>}
        />

        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          <span className="font-semibold text-slate-900">Data origin</span>
          <span className={`badge ${packet.run.dataOrigin === "fixture" ? "bg-slate-100 text-slate-700" : packet.run.dataOrigin === "mock_run" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>{packet.run.dataOrigin === "fixture" ? "Synthetic scenario" : packet.run.dataOrigin === "mock_run" ? "Deterministic mock run" : "Live provider run"}</span>
          <span className="text-slate-300">·</span>
          <span className="flex min-w-0 flex-wrap items-center gap-2">Trace ID <code className="min-w-0 break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">{packet.run.id}</code><CopyValueButton value={packet.run.id} label="Copy ID" /></span>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4 2xl:grid-cols-7">
          {[
            ["Outcome", packet.run.finalOutcome ?? packet.run.status],
            ["Automated checks", evidence.total ? `${evidence.passed}/${evidence.total}` : "Not recorded"],
            ["Latency", packet.run.latencyMs == null ? "—" : `${(packet.run.latencyMs / 1000).toFixed(1)}s`],
            ["Input tokens", `${packet.run.inputTokens}`],
            ["Output tokens", `${packet.run.outputTokens}`],
            ["Redactions", `${packet.run.redactionCount}`],
            ["Cost", packet.run.costUsd == null ? (packet.run.dataOrigin === "fixture" ? "Not priced" : "—") : `$${Number(packet.run.costUsd).toFixed(4)}`],
          ].map(([label, value]) => (
            <div key={label} className="card p-4">
              <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
            </div>
          ))}
        </div>

        <div className={"mb-5 rounded-xl border px-4 py-3 text-sm " + (packet.retentionExpired ? "border-amber-200 bg-amber-50 text-amber-950" : "border-cyan-200 bg-cyan-50 text-cyan-950")}>
          <p className="font-semibold">{packet.retentionExpired ? "Detailed AI evidence has expired" : "Evidence retention boundary"}</p>
          <p className={"mt-1 text-xs leading-5 " + (packet.retentionExpired ? "text-amber-900/80" : "text-cyan-900/80")}>{packet.retentionExpired ? "The configured AI-detail window has elapsed. The run summary and artifact links remain available, while call-level details and evaluation rows were removed by retention policy." : "This packet keeps normalized checks, opaque citation metadata, and immutable usage telemetry. Raw prompts, source text, and model output are not retained."}</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.35fr_0.85fr]">
          <div className="space-y-5">
            <section className="card p-5">
              <div
                className="flex scroll-mt-28 items-start justify-between gap-4"
                data-tour-target={TOUR_TARGETS.aiEvidenceFlow}
              >
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Evidence chain</h2>
                  <p className="mt-1 text-xs text-gray-500">Retrieval → model call → validation/repair → artifact → human decision</p>
                </div>
                <span className={`badge ${evidence.hardGatePassed === true ? "bg-emerald-50 text-emerald-700" : evidence.hardGatePassed === false ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
                  {evidence.hardGatePassed === true ? "Hard gates passed" : evidence.hardGatePassed === false ? "Attention" : "Legacy evidence"}
                </span>
              </div>
              <ol className="mt-5 space-y-4">
                {packet.calls.map((call) => {
                  const validation = call.validationEvidence;
                  return (
                    <li key={call.id} className="relative pl-8">
                      <span className={`absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${call.outcome === "valid" ? "bg-emerald-100 text-emerald-700" : call.outcome === "failed" || call.outcome === "blocked" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{call.sequence}</span>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium capitalize text-gray-800">{call.operation} · {call.outcome}</p>
                        <p className="text-xs tabular-nums text-gray-500">{call.latencyMs ?? 0}ms</p>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500">{call.provider} / {call.model ?? "unknown model"} · {call.inputTokens} in / {call.outputTokens} out · usage {call.usageSource}{call.redactionCount ? ` · ${call.redactionCount} redacted` : ""}</p>
                      {call.errorKind && <p className="mt-1 text-xs text-amber-700">Normalized failure: {call.errorKind}</p>}
                      {validation && <p className="mt-1 text-xs text-gray-500">Validation evidence: {validation.failureCodes.length ? validation.failureCodes.join(", ") : "passed"} · {validation.evaluatorVersion}</p>}
                    </li>
                  );
                })}
                {!packet.calls.length && <li className="text-sm text-gray-500">No call details were recorded for this legacy run.</li>}
              </ol>
            </section>

            <section className="card overflow-hidden">
              <div className="border-b border-gray-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-gray-900">Automated checks</h2>
                <p className="mt-1 text-xs text-gray-500">Hard gates block unsafe artifacts; quality signals identify review attention.</p>
              </div>
              {packet.evaluations.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-500"><tr><th className="px-5 py-3">Check</th><th className="px-5 py-3">Category</th><th className="px-5 py-3">Gate</th><th className="px-5 py-3 text-right">Score</th><th className="px-5 py-3">Result</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {packet.evaluations.map((evaluation) => <tr key={evaluation.id}><td className="px-5 py-3 font-mono text-xs text-gray-700">{evaluation.checkName}</td><td className="px-5 py-3 text-xs capitalize text-gray-600">{evaluation.category}</td><td className="px-5 py-3 text-xs text-gray-500">{evaluation.gateLevel === "hard_gate" ? "Hard gate" : "Quality signal"}</td><td className="px-5 py-3 text-right tabular-nums text-gray-700">{Math.round(evaluation.score * 100)}% / {Math.round(evaluation.threshold * 100)}%</td><td className="px-5 py-3"><span className={`badge ${evaluation.passed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{evaluation.passed ? "Passed" : "Attention"}</span><p className="mt-1 text-[11px] text-gray-500">{evaluation.detail}</p></td></tr>)}
                    </tbody>
                  </table>
                </div>
              ) : <p className="px-5 py-8 text-sm text-gray-500">Automated checks were not recorded for this legacy run.</p>}
            </section>
          </div>

          <div className="space-y-5">
            <section className="card p-5">
              <h2 className="text-sm font-semibold text-gray-900">Artifact and human decision</h2>
              {packet.artifact ? <div className="mt-4 rounded-lg border border-gray-100 bg-slate-50 p-3"><p className="text-xs uppercase tracking-wide text-gray-500">Generated artifact</p><Link href={packet.artifact.href} className="mt-1 block text-sm font-semibold text-indigo-700 hover:underline">Plan v{packet.artifact.version} · {packet.artifact.status}</Link><p className="mt-1 text-xs text-gray-500">The artifact link is tenant-scoped and remains subject to the current role.</p></div> : <p className="mt-4 text-sm text-gray-500">No persisted artifact is associated with this run.</p>}
              {packet.approval ? <div className="mt-3 rounded-lg border border-gray-100 p-3"><div className="flex items-center justify-between gap-3"><span className="text-xs uppercase tracking-wide text-gray-500">Approval</span><span className={`badge ${packet.approval.status === "approved" ? "bg-emerald-50 text-emerald-700" : packet.approval.status === "rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{packet.approval.status}</span></div><p className="mt-2 text-xs text-gray-500">Requested {packet.approval.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}{packet.approval.requestedByName ? ` by ${packet.approval.requestedByName}` : ""}{packet.approval.decidedAt ? ` · decided ${packet.approval.decidedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}${packet.approval.decidedByName ? ` by ${packet.approval.decidedByName}` : ""}` : ""}</p>{packet.approval.note && <p className="mt-2 text-xs leading-5 text-gray-600">{packet.approval.note}</p>}</div> : <p className="mt-3 text-sm text-gray-500">No human decision is associated with this run.</p>}
            </section>

            <section className="card p-5">
              <h2 className="text-sm font-semibold text-gray-900">Grounding coverage</h2>
              <p className="mt-1 text-xs text-gray-500">Opaque citation refs and requirement links are counted without exposing source text.</p>
              {packet.coverage ? <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-lg bg-slate-50 p-3"><p className="text-2xl font-semibold text-slate-900">{packet.coverage.requirementsCovered}/{packet.coverage.requirementsTotal}</p><p className="mt-1 text-xs text-gray-500">requirements covered</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-2xl font-semibold text-slate-900">{packet.coverage.citationsUsed}/{packet.coverage.citationsTotal}</p><p className="mt-1 text-xs text-gray-500">citation refs used</p></div></div> : <p className="mt-4 text-sm text-gray-500">Coverage is unavailable for this artifact type.</p>}
              <div className="mt-4 space-y-2">{packet.citations.map((citation) => <div key={citation.id} className="rounded-md border border-gray-100 bg-slate-50 px-3 py-2 text-xs"><div><span className="font-mono font-semibold text-indigo-700">{citation.sourceRef}</span><span className="ml-2 text-gray-600">{citation.location ?? "document chunk"}</span></div><p className="mt-1 text-[11px] text-gray-500">{citation.retrieverVersion} · rank {citation.rank ?? "—"} · vector {citation.vectorScore ?? "—"} · lexical {citation.lexicalScore ?? "—"}</p>{citation.selectionReason && <p className="mt-1 text-[11px] text-gray-500">{citation.selectionReason}</p>}</div>)}{!packet.citations.length && <p className="text-sm text-gray-500">No document citations on this run.</p>}</div>
            </section>
          </div>
        </div>
      </div>
    );
  }, session.userId);
}
