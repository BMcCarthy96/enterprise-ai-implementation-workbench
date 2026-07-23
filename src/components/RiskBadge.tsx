import type { RiskLevel } from "@/server/services/sla";

const BADGE: Record<string, { cls: string; label: string }> = {
  breached: { cls: "bg-red-100 text-red-700 ring-red-200", label: "Breached" },
  at_risk: { cls: "bg-amber-100 text-amber-700 ring-amber-200", label: "At risk" },
};

/** Pill badge for a project's overall risk level. Renders nothing when on track. */
export function RiskBadge({ level }: { level: RiskLevel }) {
  const b = BADGE[level];
  if (!b) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${b.cls}`}
    >
      {b.label}
    </span>
  );
}

/** Small status dot for inline use in dense lists. Renders nothing when on track. */
export function RiskDot({ level }: { level: RiskLevel }) {
  if (level === "on_track") return null;
  const color = level === "breached" ? "bg-red-500" : "bg-amber-500";
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`}
      title={level === "breached" ? "SLA breached" : "At risk"}
      aria-label={level === "breached" ? "SLA breached" : "At risk"}
    />
  );
}
