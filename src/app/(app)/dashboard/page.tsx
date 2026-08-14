import Link from "next/link";
import { withTenantTransaction } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DeliveryRiskPanel } from "@/components/DeliveryRiskPanel";
import { RiskBadge } from "@/components/RiskBadge";
import { getDashboardSnapshot, type DashboardKpi, type DashboardProjectHealth } from "@/server/services/dashboard";

export const dynamic = "force-dynamic";

function KpiIcon({ id }: { id: DashboardKpi["id"] }) {
  const paths: Record<DashboardKpi["id"], string> = {
    projects: "M4 5h16M4 12h16M4 19h16",
    approvals: "M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    tasks: "m5 12 4 4L19 6",
    jobs: "M12 3v18m9-9H3",
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d={paths[id]} /></svg>;
}

function toneClasses(tone: DashboardKpi["tone"]): string {
  return {
    cyan: "bg-cyan-50 text-cyan-700 ring-cyan-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  }[tone];
}

function statusName(status: string): string {
  return status.replace(/_/g, " ");
}

function ProjectHealthRow({ project }: { project: DashboardProjectHealth }) {
  return (
    <li className="group border-t border-slate-100 px-4 py-4 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/projects/${project.id}`} className="truncate text-sm font-semibold text-slate-900 hover:text-indigo-700">{project.name}</Link>
            <StatusBadge status={project.status} />
            <RiskBadge level={project.risk} />
          </div>
          <p className="mt-1 text-xs text-slate-500">{project.customerName} · target {project.targetLabel}{project.nextMilestone ? ` · next ${project.nextMilestone}` : ""}</p>
        </div>
        <Link href={project.nextActionHref} className="text-xs font-semibold text-indigo-700 opacity-100 hover:text-indigo-900">{project.nextAction} <span aria-hidden>→</span></Link>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`${project.name} completion`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={project.completionPercent}><div className={`h-full rounded-full ${project.risk === "breached" ? "bg-rose-400" : project.risk === "at_risk" ? "bg-amber-400" : "bg-cyan-400"}`} style={{ width: `${project.completionPercent}%` }} /></div>
        <span className="w-24 text-right text-xs tabular-nums text-slate-500">{project.completedTasks}/{project.totalTasks || 0} tasks · {project.completionPercent}%</span>
      </div>
      {project.signals.length > 0 && <p className="mt-2 text-xs font-medium text-rose-700">Signal · {project.signals[0]}</p>}
    </li>
  );
}

function TaskBreakdown({ rows }: { rows: Array<{ status: string; count: number }> }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const colors: Record<string, string> = { done: "bg-emerald-400", in_progress: "bg-indigo-500", in_review: "bg-amber-400", blocked: "bg-rose-500", todo: "bg-slate-300" };
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" aria-label="Task status distribution" role="img">
        {rows.filter((row) => row.count > 0).map((row) => <div key={row.status} className={`${colors[row.status] ?? "bg-slate-300"} transition-[width] duration-500 motion-reduce:transition-none`} style={{ width: `${total ? (row.count / total) * 100 : 0}%` }} title={`${statusName(row.status)}: ${row.count}`} />)}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-600">
        {rows.map((row) => <li key={row.status} className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5"><span aria-hidden className={`h-2 w-2 rounded-full ${colors[row.status] ?? "bg-slate-300"}`} />{statusName(row.status)}</span><span className="tabular-nums text-slate-900">{row.count}</span></li>)}
      </ul>
    </div>
  );
}

export default async function DashboardPage() {
  const session = (await getSession())!;
  const isInternal = can(session.role, "internal.view");
  const snapshot = await withTenantTransaction(
    session.orgId,
    () => getDashboardSnapshot(session.orgId, isInternal),
    session.userId,
  );

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader
        title={`Welcome back, ${session.name.split(" ")[0]}`}
        subtitle={isInternal ? "Delivery health, governance, and recorded AI evidence in one view." : "Your implementation projects at a glance."}
      />

      <section aria-label="Portfolio summary" className={`mb-6 grid gap-3 ${snapshot.kpis.length > 1 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-2"}`}>
        {snapshot.kpis.map((kpi) => (
          <Link key={kpi.id} href={kpi.href} aria-label={`${kpi.value} ${kpi.label}`} className="card group p-4 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md motion-reduce:transform-none">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-500">{kpi.label}</p><p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{kpi.value}</p></div><span className={`rounded-lg p-2 ring-1 ring-inset ${toneClasses(kpi.tone)}`}><KpiIcon id={kpi.id} /></span></div>
            <p className="mt-2 truncate text-xs text-slate-500">{kpi.context}</p>
          </Link>
        ))}
      </section>

      {isInternal && <DeliveryRiskPanel {...snapshot.delivery} />}

      <div className="grid gap-6 xl:grid-cols-5">
        <section className="card overflow-hidden xl:col-span-3" aria-labelledby="portfolio-health-heading">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 id="portfolio-health-heading" className="text-sm font-semibold text-slate-950">Portfolio health</h2><p className="mt-0.5 text-xs text-slate-500">Progress, stage, target, and next action for every project.</p></div><Link href="/projects" className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">View all <span aria-hidden>→</span></Link></div>
          <ul>{snapshot.projects.slice(0, 6).map((project) => <ProjectHealthRow key={project.id} project={project} />)}{snapshot.projects.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-500">No projects yet. Create a project to see portfolio health.</li>}</ul>
        </section>

        {isInternal && <section className="card overflow-hidden xl:col-span-2" aria-labelledby="ai-proof-heading">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 id="ai-proof-heading" className="text-sm font-semibold text-slate-950">AI proof</h2><p className="mt-0.5 text-xs text-slate-500">Recorded quality signals from plan runs.</p></div><span className="rounded-full bg-cyan-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-700">Recorded evidence</span></div>
          {snapshot.aiProof && snapshot.aiProof.planRuns > 0 ? <div className="p-4"><div className="grid grid-cols-2 gap-3"><div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Plan runs</p><p className="mt-1 text-xl font-semibold text-slate-950">{snapshot.aiProof.planRuns}</p><p className="mt-1 text-[11px] text-slate-500">{snapshot.aiProof.successfulRuns} succeeded</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">First-pass valid</p><p className="mt-1 text-xl font-semibold text-slate-950">{snapshot.aiProof.firstPassValidityRate == null ? "—" : `${snapshot.aiProof.firstPassValidityRate}%`}</p><p className="mt-1 text-[11px] text-slate-500">repair rescue {snapshot.aiProof.repairRescueRate == null ? "—" : `${snapshot.aiProof.repairRescueRate}%`}</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Evidence gates</p><p className="mt-1 text-xl font-semibold text-slate-950">{snapshot.aiProof.hardGatePassRate == null ? "—" : `${snapshot.aiProof.hardGatePassRate}%`}</p><p className="mt-1 text-[11px] text-slate-500">{snapshot.aiProof.evaluatedRuns} evaluated runs</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Cost / plan</p><p className="mt-1 text-xl font-semibold text-slate-950">{snapshot.aiProof.costPerPlanUsd == null ? "—" : `$${snapshot.aiProof.costPerPlanUsd.toFixed(4)}`}</p><p className="mt-1 text-[11px] text-slate-500">recorded usage</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Latency</p><p className="mt-1 text-xl font-semibold text-slate-950">{snapshot.aiProof.p50LatencyMs == null ? "—" : `${snapshot.aiProof.p50LatencyMs}ms`}</p><p className="mt-1 text-[11px] text-slate-500">p95 {snapshot.aiProof.p95LatencyMs == null ? "—" : `${snapshot.aiProof.p95LatencyMs}ms`}</p></div></div><div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3"><p className="text-xs text-slate-500">Latest outcome <span className="font-semibold text-emerald-700">{snapshot.aiProof.latestOutcome ?? "not recorded"}</span></p><Link href={snapshot.aiProof.href} className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">View AI evidence <span aria-hidden>→</span></Link></div></div> : <div className="p-6 text-center text-sm text-slate-500">AI evidence will appear after the first plan run.</div>}
        </section>}
      </div>

      {isInternal && <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card overflow-hidden lg:col-span-2" aria-labelledby="action-queue-heading">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 id="action-queue-heading" className="text-sm font-semibold text-slate-950">Action queue</h2><p className="mt-0.5 text-xs text-slate-500">The smallest set of next actions that protects delivery momentum.</p></div><Link href="/ops" className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">Open queue <span aria-hidden>→</span></Link></div>
          {snapshot.actionQueue.length > 0 ? <ul className="divide-y divide-slate-100">{snapshot.actionQueue.map((item) => <li key={item.id}><Link href={item.href} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50"><span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${item.tone === "rose" ? "bg-rose-500" : item.tone === "amber" ? "bg-amber-400" : "bg-cyan-400"}`} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{item.title}</span><span className="block truncate text-xs text-slate-500">{item.detail}</span></span><span aria-hidden className="text-slate-400">→</span></Link></li>)}</ul> : <p className="px-4 py-8 text-center text-sm text-emerald-700">No urgent actions. Delivery controls are clear.</p>}
        </section>
        <section className="card p-4" aria-labelledby="task-breakdown-heading"><div className="flex items-start justify-between"><div><h2 id="task-breakdown-heading" className="text-sm font-semibold text-slate-950">Task mix</h2><p className="mt-0.5 text-xs text-slate-500">Current work by status</p></div><Link href="/projects" className="text-xs font-semibold text-indigo-700">Board <span aria-hidden>→</span></Link></div><div className="mt-5"><TaskBreakdown rows={snapshot.taskBreakdown} /></div></section>
      </div>}

      {isInternal && <section className="card mt-6 overflow-hidden" aria-labelledby="activity-heading"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 id="activity-heading" className="text-sm font-semibold text-slate-950">Recent human activity</h2><p className="mt-0.5 text-xs text-slate-500">A compact, attributable audit timeline.</p></div><Link href="/audit" className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">Open audit log <span aria-hidden>→</span></Link></div>{snapshot.activity.length > 0 ? <ul className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-y-0">{snapshot.activity.map((event) => <li key={event.id} className="flex gap-3 border-b border-slate-100 px-4 py-3 last:border-0 md:border-b md:even:border-l"><span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cyan-400 ring-4 ring-cyan-50" /><span className="min-w-0"><span className="block truncate text-xs font-medium capitalize text-slate-700">{event.action}</span><span className="block truncate text-[11px] text-slate-400">{event.actor} · {event.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></span></li>)}</ul> : <p className="px-4 py-8 text-center text-sm text-slate-500">No activity yet.</p>}</section>}
    </div>
  );
}
