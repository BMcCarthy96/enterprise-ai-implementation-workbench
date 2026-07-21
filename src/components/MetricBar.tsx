/**
 * Horizontal breakdown bar — a dependency-free alternative to a chart library
 * that fits the restrained B2B aesthetic. Rows are sorted by the caller.
 */
export function MetricBars({
  rows,
  emptyLabel = "No data yet",
}: {
  rows: Array<{ label: string; count: number; tone?: string }>;
  emptyLabel?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-3">
          <span className="w-40 shrink-0 truncate text-sm capitalize text-gray-600">
            {r.label.replace(/_/g, " ")}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full ${r.tone ?? "bg-indigo-500"}`}
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right text-sm tabular-nums text-gray-700">
            {r.count}
          </span>
        </li>
      ))}
    </ul>
  );
}
