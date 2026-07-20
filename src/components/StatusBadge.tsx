const STYLES: Record<string, string> = {
  // project
  discovery: "bg-sky-100 text-sky-800",
  planning: "bg-violet-100 text-violet-800",
  in_delivery: "bg-indigo-100 text-indigo-800",
  on_hold: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-800",
  // requirement / generic
  new: "bg-sky-100 text-sky-800",
  in_plan: "bg-indigo-100 text-indigo-800",
  delivered: "bg-emerald-100 text-emerald-800",
  deferred: "bg-gray-100 text-gray-600",
  // plan / approval / update
  draft: "bg-gray-100 text-gray-600",
  pending_approval: "bg-amber-100 text-amber-800",
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  superseded: "bg-gray-100 text-gray-600",
  published: "bg-emerald-100 text-emerald-800",
  // task / milestone
  todo: "bg-gray-100 text-gray-600",
  not_started: "bg-gray-100 text-gray-600",
  in_progress: "bg-indigo-100 text-indigo-800",
  blocked: "bg-red-100 text-red-800",
  in_review: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-800",
  complete: "bg-emerald-100 text-emerald-800",
  // jobs
  queued: "bg-sky-100 text-sky-800",
  running: "bg-indigo-100 text-indigo-800",
  succeeded: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  dead_letter: "bg-red-100 text-red-800",
  // priority
  low: "bg-gray-100 text-gray-600",
  medium: "bg-sky-100 text-sky-800",
  high: "bg-amber-100 text-amber-800",
  critical: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STYLES[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
