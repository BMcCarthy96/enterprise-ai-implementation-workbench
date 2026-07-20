import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { RetryJobButton } from "./RetryJobButton";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  const session = (await getSession())!;
  if (!can(session.role, "ops.view")) redirect("/dashboard");
  const canRetry = can(session.role, "ops.retry_jobs");

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
                    {job.type === "plan_generation"
                      ? "Plan generation"
                      : "Update digest"}
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
