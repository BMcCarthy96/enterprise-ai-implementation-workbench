import { and, desc, eq, gt } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema, withTenantTransaction } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { RetryJobButton } from "./RetryJobButton";

export const dynamic = "force-dynamic";

const JOB_TYPE_LABELS: Record<string, string> = {
  plan_generation: "Plan generation",
  customer_update_digest: "Update digest",
  document_ingest: "Document ingest",
  webhook_delivery: "Webhook delivery",
};

export default async function OpsPage() {
  const session = (await getSession())!;
  if (!can(session.role, "ops.view")) redirect("/dashboard");
  const canRetry = can(session.role, "ops.retry_jobs");

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
  const operations = await withTenantTransaction(
    session.orgId,
    async () => {
      const jobs = await db
        .select({
          job: schema.jobs,
          projectName: schema.projects.name,
        })
        .from(schema.jobs)
        .leftJoin(schema.projects, eq(schema.jobs.projectId, schema.projects.id))
        .where(eq(schema.jobs.orgId, session.orgId))
        .orderBy(desc(schema.jobs.createdAt))
        .limit(100);
      const deliveries = await db.query.webhookDeliveries.findMany({
        where: and(eq(schema.webhookDeliveries.orgId, session.orgId), gt(schema.webhookDeliveries.createdAt, thirtyDaysAgo)),
        columns: { status: true, createdAt: true },
      });
      const lastRetentionRun = await db.query.retentionRuns.findFirst({
        where: eq(schema.retentionRuns.orgId, session.orgId),
        orderBy: [desc(schema.retentionRuns.startedAt)],
        columns: { status: true, startedAt: true, finishedAt: true, counts: true },
      });
      return { jobs, deliveries, lastRetentionRun };
    },
    session.userId,
  );
  const { jobs, deliveries, lastRetentionRun } = operations;

  const total = jobs.length;
  const succeeded = jobs.filter((j) => j.job.status === "succeeded").length;
  const problems = jobs.filter((j) =>
    ["failed", "dead_letter"].includes(j.job.status),
  ).length;
  const durations = jobs
    .filter((j) => j.job.durationMs != null)
    .map((j) => j.job.durationMs!);
  const avgMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  const queuedJobs = jobs.filter((item) => item.job.status === "queued");
  const oldestQueuedSeconds = queuedJobs.length
    ? Math.max(...queuedJobs.map((item) => Math.round((now.getTime() - item.job.createdAt.getTime()) / 1000)))
    : 0;
  const deliveredWebhooks = deliveries.filter((delivery) => delivery.status === "delivered").length;
  const queueObserved = oldestQueuedSeconds ? "Oldest " + oldestQueuedSeconds + "s" : "No queued jobs";
  const jobTerminalObserved = total ? Math.round((succeeded / total) * 100) + "% recent" : "No sample";

  return (
    <div>
      <PageHeader
        title="Operations"
        subtitle="Background job health: AI plan generation and customer update digests"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-2xl font-semibold text-gray-900">{total}</p>
          <p className="mt-1 text-sm text-gray-500">Recent jobs</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-semibold text-emerald-600">
            {total ? Math.round((succeeded / total) * 100) : 0}%
          </p>
          <p className="mt-1 text-sm text-gray-500">Success rate</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-semibold text-gray-900">
            {avgMs ? `${(avgMs / 1000).toFixed(1)}s` : "—"}
          </p>
          <p className="mt-1 text-sm text-gray-500">Avg duration</p>
        </div>
        <div className="card p-4">
          <p
            className={`text-2xl font-semibold ${problems ? "text-red-600" : "text-gray-900"}`}
          >
            {problems}
          </p>
          <p className="mt-1 text-sm text-gray-500">Failed / dead-letter</p>
        </div>
      </div>

      <section className="card mb-6 border-amber-200 bg-amber-50/50 p-5" aria-labelledby="slo-targets">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="slo-targets" className="text-sm font-semibold text-gray-900">Reliability targets</h2>
            <p className="mt-1 text-xs text-gray-600">Targets are intentionally separated from observed data; no uptime or DR result is claimed by this demo.</p>
          </div>
          <span className="badge badge-amber">Operating target</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Availability", "99.5% / 30d", "Not measured"],
            ["Non-AI API p95", "< 750 ms", "Tracing enabled"],
            ["Queue start", "95% < 60s", queueObserved],
            ["Job terminal success", "95% success", jobTerminalObserved],
            ["DR objective", "24h RPO · 4h RTO", "Not exercised"],
          ].map(([label, target, observed]) => (
            <div key={label} className="rounded-lg border border-amber-100 bg-white/80 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{target}</p>
              <p className="mt-1 text-xs text-gray-500">Observed: {observed}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-600">
          <span>Webhook delivery: {deliveries.length ? Math.round((deliveredWebhooks / deliveries.length) * 100) + "% in 30d" : "no sample"}</span>
          <span>Retention ledger: {lastRetentionRun?.status ?? "not run"}</span>
          <span>Trace correlation: persisted on queued jobs</span>
          <span>Lease recovery: {jobs.some((item) => item.job.leaseOwner) ? "worker heartbeat observed" : "ready; no active lease"}</span>
        </div>
      </section>

      {jobs.length === 0 ? (
        <EmptyState
          title="No jobs yet"
          hint="Generate an implementation plan or customer update to see background jobs here."
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-th">Type</th>
                <th className="table-th">Project</th>
                <th className="table-th">Status</th>
                <th className="table-th">Attempts</th>
                <th className="table-th">Lease</th>
                <th className="table-th">Duration</th>
                <th className="table-th">Created</th>
                <th className="table-th">Error</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {jobs.map(({ job, projectName }) => (
                <tr key={job.id}>
                  <td className="table-td whitespace-nowrap">
                    {JOB_TYPE_LABELS[job.type] ?? job.type.replaceAll("_", " ")}
                  </td>
                  <td className="table-td max-w-40 truncate text-xs">
                    {projectName ?? "—"}
                  </td>
                  <td className="table-td">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="table-td">
                    {job.attempts}/{job.maxAttempts}
                  </td>
                  <td className="table-td max-w-44 text-xs text-gray-500">
                    {job.status === "running" ? (
                      <span title={job.leaseOwner ?? undefined}>
                        {job.leaseExpiresAt && job.leaseExpiresAt > now
                          ? `heartbeat · expires ${job.leaseExpiresAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                          : "lease expired · reclaiming"}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="table-td">
                    {job.durationMs != null
                      ? `${(job.durationMs / 1000).toFixed(1)}s`
                      : "—"}
                  </td>
                  <td className="table-td whitespace-nowrap text-xs text-gray-500">
                    {job.createdAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    {job.createdAt.toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="table-td max-w-56">
                    {job.lastError && (
                      <span
                        className="block truncate text-xs text-red-600"
                        title={job.lastError}
                      >
                        {job.lastError}
                      </span>
                    )}
                  </td>
                  <td className="table-td">
                    {canRetry &&
                      (job.status === "failed" ||
                        job.status === "dead_letter") && (
                        <RetryJobButton jobId={job.id} />
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
