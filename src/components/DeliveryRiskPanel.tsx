import Link from "next/link";
import type { DeliveryRisks, SlaSignal } from "@/server/services/sla";
import { RiskBadge } from "./RiskBadge";

function SignalChip({ signal }: { signal: SlaSignal }) {
  const cls =
    signal.level === "breached"
      ? "bg-red-50 text-red-700 ring-red-100"
      : "bg-amber-50 text-amber-700 ring-amber-100";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs ring-1 ring-inset ${cls}`}
    >
      {signal.label}
    </span>
  );
}

/**
 * Dashboard panel listing every actively-delivering project that is at risk or
 * breached, worst first, with the specific SLA signals that tripped. A left
 * accent colours the whole card by the most severe state.
 */
export function DeliveryRiskPanel({ risks, counts }: DeliveryRisks) {
  const hasRisk = risks.length > 0;
  const accent = counts.breached > 0
    ? "border-l-red-400"
    : hasRisk
      ? "border-l-amber-400"
      : "border-l-emerald-400";

  return (
    <div className={`card mb-6 border-l-4 ${accent}`}>
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Delivery risk</h2>
        <span className="text-xs font-medium text-gray-500">
          {hasRisk
            ? `${counts.breached} breached · ${counts.atRisk} at risk`
            : "All active projects on track"}
        </span>
      </div>

      {hasRisk ? (
        <ul className="divide-y divide-gray-100">
          {risks.map((r) => (
            <li
              key={r.projectId}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
            >
              <Link href={`/projects/${r.projectId}`} className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900 hover:text-indigo-700">
                  {r.projectName}
                </p>
                <p className="truncate text-xs text-gray-500">{r.customerName}</p>
              </Link>
              <RiskBadge level={r.level} />
              <div className="flex w-full flex-wrap gap-1.5 sm:w-auto">
                {r.signals.map((s, i) => (
                  <SignalChip key={i} signal={s} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-gray-500">
          No target-date, blocked-task, or approval-turnaround SLAs are breached
          right now.
        </p>
      )}
    </div>
  );
}
