import type {
  PhaseStatus,
  ProjectTimeline as Timeline,
  TimelinePhase,
} from "@/server/services/timeline";

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

const PHASE_LABEL: Record<PhaseStatus, string> = {
  complete: "Completed",
  in_progress: "In progress",
  upcoming: "Upcoming",
};

function PhaseDot({ status }: { status: PhaseStatus }) {
  const base =
    "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-white";
  if (status === "complete") {
    return (
      <span className={`${base} bg-emerald-500`} aria-hidden>
        <svg viewBox="0 0 12 12" className="h-3 w-3 text-white" fill="none">
          <path
            d="M2.5 6.5l2.5 2.5 4.5-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className={`${base} border-2 border-indigo-500 bg-white`} aria-hidden>
        <span className="h-2 w-2 rounded-full bg-indigo-500" />
      </span>
    );
  }
  return (
    <span className={`${base} border-2 border-gray-300 bg-white`} aria-hidden />
  );
}

function PhaseRow({ phase, last }: { phase: TimelinePhase; last: boolean }) {
  const pct =
    phase.taskCount === 0 ? 0 : Math.round((phase.doneCount / phase.taskCount) * 100);
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      {!last && (
        <span
          className="absolute left-3 top-6 -ml-px h-full w-0.5 bg-gray-200"
          aria-hidden
        />
      )}
      <PhaseDot status={phase.status} />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p
            className={`text-sm font-medium ${
              phase.status === "upcoming" ? "text-gray-500" : "text-gray-900"
            }`}
          >
            {phase.name}
          </p>
          <span className="text-xs text-gray-400">{PHASE_LABEL[phase.status]}</span>
        </div>
        {phase.description && (
          <p className="mt-0.5 text-sm leading-relaxed text-gray-500">
            {phase.description}
          </p>
        )}
        {phase.taskCount > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full ${
                  phase.status === "complete" ? "bg-emerald-500" : "bg-indigo-500"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-gray-400">
              {phase.doneCount} of {phase.taskCount} tasks
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Customer-facing status timeline: overall progress, the delivery phases as an
 * ordered spine, and the published update history. Everything shown here is
 * safe for an external stakeholder by construction — see
 * `src/server/services/timeline.ts`.
 */
export function ProjectTimeline({ timeline }: { timeline: Timeline }) {
  const { progress, phases, updates } = timeline;

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-2xl font-semibold text-gray-900">
              {progress.percent}%
            </p>
            <p className="text-sm text-gray-500">
              {progress.phasesTotal > 0
                ? `${progress.phasesComplete} of ${progress.phasesTotal} phases complete · ${progress.tasksDone} of ${progress.tasksTotal} tasks done`
                : "Delivery plan not finalized yet"}
            </p>
          </div>
          <div className="text-right text-xs text-gray-500">
            <p>Started {fmtDate(timeline.startedAt)}</p>
            {timeline.targetDate && <p>Target {fmtDate(timeline.targetDate)}</p>}
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-indigo-600 transition-all"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Delivery phases</h2>
        {phases.length === 0 ? (
          <p className="text-sm text-gray-500">
            Your implementation plan is still being scoped. Phases appear here once
            the plan is finalized.
          </p>
        ) : (
          <ul>
            {phases.map((p, i) => (
              <PhaseRow key={p.id} phase={p} last={i === phases.length - 1} />
            ))}
          </ul>
        )}
      </div>

      <div className="card p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">
          Published updates
        </h2>
        {updates.length === 0 ? (
          <p className="text-sm text-gray-500">
            No status updates have been published yet.
          </p>
        ) : (
          <ul className="space-y-4">
            {updates.map((u) => (
              <li key={u.id} className="border-l-2 border-gray-200 pl-4">
                <p className="text-xs text-gray-400">{fmtDate(u.publishedAt)}</p>
                <p className="text-sm font-medium text-gray-900">{u.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-gray-600">
                  {u.excerpt}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
