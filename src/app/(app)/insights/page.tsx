import { redirect } from "next/navigation";
import { withTenantTransaction } from "@/db";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { getInsights } from "@/server/services/insights";
import { PageHeader } from "@/components/PageHeader";
import { MetricBars } from "@/components/MetricBar";
import scoreboardJson from "../../../../evals/scoreboard.json";
import { EvalScoreboardSchema } from "@/lib/ai/evidence";

export const dynamic = "force-dynamic";

const scoreboard = EvalScoreboardSchema.parse(scoreboardJson);
const scoreboardIsStaleAtRender = Date.now();

const STATUS_TONES: Record<string, string> = {
  done: "bg-emerald-500",
  complete: "bg-emerald-500",
  completed: "bg-emerald-500",
  in_delivery: "bg-indigo-500",
  in_progress: "bg-indigo-500",
  blocked: "bg-red-500",
  on_hold: "bg-amber-500",
  todo: "bg-gray-400",
  in_review: "bg-amber-500",
  discovery: "bg-sky-500",
  planning: "bg-violet-500",
};

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="card p-4">
      <p className={`text-2xl font-semibold ${tone ?? "text-gray-900"}`}>
        {value}
      </p>
      <p className="mt-1 text-sm text-gray-500">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {subtitle && <p className="mb-3 mt-0.5 text-xs text-gray-500">{subtitle}</p>}
      <div className={subtitle ? "" : "mt-3"}>{children}</div>
    </div>
  );
}

export default async function InsightsPage() {
  const session = (await getSession())!;
  // Org-wide analytics: admins and implementation managers only.
  if (!can(session.role, "audit.view")) redirect("/dashboard");

  const i = await withTenantTransaction(
    session.orgId,
    () => getInsights(session.orgId),
    session.userId,
  );

  const pctTone = (v: number | null) =>
    v == null ? "text-gray-900" : v >= 80 ? "text-emerald-600" : v >= 50 ? "text-amber-600" : "text-red-600";
  const scoreboardGeneratedAt = new Date(scoreboard.generatedAt);
  const scoreboardIsStale = scoreboardIsStaleAtRender - scoreboardGeneratedAt.getTime() > 30 * 86400000;

  return (
    <div>
      <PageHeader
        title="Insights"
        subtitle="AI output quality and delivery health across your organization"
        actions={<Link href="/ai-runs" className="btn-secondary">Open evidence center</Link>}
      />

      {/* AI quality — the eval story */}
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        AI output quality
      </h2>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Plan approval rate"
          value={i.planQuality.approvalRate == null ? "—" : `${i.planQuality.approvalRate}%`}
          hint={`${i.planQuality.approved} approved · ${i.planQuality.rejected} rejected`}
          tone={pctTone(i.planQuality.approvalRate)}
        />
        <Stat
          label="Avg approval turnaround"
          value={
            i.planQuality.avgTurnaroundHours == null
              ? "—"
              : `${i.planQuality.avgTurnaroundHours}h`
          }
          hint="request → decision"
        />
        <Stat
          label="Plan generation success"
          value={
            i.planJobReliability.successRate == null
              ? "—"
              : `${i.planJobReliability.successRate}%`
          }
          hint={`${i.planJobReliability.deadLetter} dead-letter · ${i.planJobReliability.retryRate ?? 0}% retried`}
          tone={pctTone(i.planJobReliability.successRate)}
        />
        <Stat
          label="Avg generation latency"
          value={
            i.planJobReliability.avgDurationMs == null
              ? "—"
              : `${(i.planJobReliability.avgDurationMs / 1000).toFixed(1)}s`
          }
          hint="worker job duration"
        />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="AI plan runs" value={`${i.aiQuality.runCount}`} hint={`${i.aiQuality.succeeded} succeeded`} />
        <Stat label="Cost per plan" value={i.aiQuality.costPerPlanUsd == null ? "—" : `$${i.aiQuality.costPerPlanUsd.toFixed(4)}`} hint="versioned pricing catalog" />
        <Stat label="P50 / P95 latency" value={i.aiQuality.p50LatencyMs == null ? "—" : `${(i.aiQuality.p50LatencyMs / 1000).toFixed(1)}s / ${(i.aiQuality.p95LatencyMs ?? 0) / 1000}s`} hint="provider + retrieval trace" />
        <Stat label="First-pass valid" value={i.aiQuality.firstAttemptValidityRate == null ? "—" : `${i.aiQuality.firstAttemptValidityRate}%`} hint={`${i.aiQuality.repairRescueRate ?? 0}% repair rescue`} tone={pctTone(i.aiQuality.firstAttemptValidityRate)} />
        <Stat label="Guardrail failures" value={`${i.aiQuality.guardrailFailures}`} hint="invalid / blocked calls" tone={i.aiQuality.guardrailFailures ? "text-amber-600" : "text-emerald-600"} />
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Why AI output gets rejected"
          subtitle="Reviewer reason codes — the signal that drives prompt iteration"
        >
          <MetricBars
            rows={i.rejectionReasons.map((r) => ({
              label: r.reason,
              count: r.count,
              tone: "bg-red-400",
            }))}
            emptyLabel="No rejections recorded — every reviewed draft was accepted."
          />
        </Panel>
        <Panel
          title="Quality by prompt version"
          subtitle="Approval outcomes grouped by the prompt that produced them"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-1 text-left font-semibold">Prompt version</th>
                  <th className="py-1 text-right font-semibold">Plans</th>
                  <th className="py-1 text-right font-semibold">Approved</th>
                  <th className="py-1 text-right font-semibold">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {i.byPromptVersion.map((p) => (
                  <tr key={p.promptVersion}>
                    <td className="py-1.5 font-mono text-xs text-gray-700">
                      {p.promptVersion}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{p.total}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {p.approved}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-gray-600">
                      {p.total ? Math.round((p.approved / p.total) * 100) : 0}%
                    </td>
                  </tr>
                ))}
                {i.byPromptVersion.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-gray-500">
                      No plans generated yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="mb-8 card p-5" data-testid="offline-regression-scorecard">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-sm font-semibold text-gray-900">Offline regression suite</h2><p className="mt-1 text-xs text-gray-500">Separate from live telemetry: committed cases, prompt variants, and baseline comparison.</p></div>
          <span className={`badge ${scoreboard.hardGatesPassed ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{scoreboard.hardGatesPassed ? "Hard gates passed" : "Needs attention"}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-semibold text-slate-900">{scoreboard.caseCount}</p><p className="text-xs text-gray-500">cases</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-semibold text-slate-900">{scoreboard.variantCount ?? Object.keys(scoreboard.variants).length}</p><p className="text-xs text-gray-500">prompt variants</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-semibold text-slate-900">{scoreboard.provider}</p><p className="text-xs text-gray-500">provider</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-semibold text-slate-900">{scoreboard.baseline?.compared ? `${(scoreboard.baseline.maxAggregateRegression * 100).toFixed(1)}pt` : "—"}</p><p className="text-xs text-gray-500">max baseline delta</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-semibold text-slate-900">{scoreboardGeneratedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p><p className="text-xs text-gray-500">generated{scoreboardIsStale ? " · stale" : " · current"}</p></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">{Object.entries(scoreboard.variants).map(([variant, value]) => <span key={variant} className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600">{variant} · {Math.round(value.schemaValidRate * 100)}% schema · {Math.round((value.citationValidity ?? 0) * 100)}% grounding</span>)}</div>
      </div>

      {/* Delivery health */}
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Delivery health
      </h2>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Requirements captured" value={`${i.delivery.totalRequirements}`} />
        <Stat label="Plans generated" value={`${i.delivery.totalPlans}`} />
        <Stat
          label="Customer updates published"
          value={`${i.delivery.totalUpdatesPublished}`}
        />
        <Stat
          label="Update approval rate"
          value={i.updateQuality.approvalRate == null ? "—" : `${i.updateQuality.approvalRate}%`}
          hint={`${i.updateQuality.approved} approved · ${i.updateQuality.rejected} rejected`}
          tone={pctTone(i.updateQuality.approvalRate)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Projects by stage">
          <MetricBars
            rows={i.delivery.projectsByStatus.map((s) => ({
              label: s.key,
              count: s.count,
              tone: STATUS_TONES[s.key],
            }))}
          />
        </Panel>
        <Panel title="Tasks by status">
          <MetricBars
            rows={i.delivery.tasksByStatus.map((s) => ({
              label: s.key,
              count: s.count,
              tone: STATUS_TONES[s.key],
            }))}
            emptyLabel="No tasks yet — approve a plan to populate the board."
          />
        </Panel>
      </div>
    </div>
  );
}
