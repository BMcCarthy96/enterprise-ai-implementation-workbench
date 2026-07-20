"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";

const STATUSES = [
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "done",
] as const;

export function TaskCard({
  task,
  canManage,
}: {
  task: {
    id: string;
    title: string;
    status: string;
    priority: string;
    assigneeName: string | null;
    milestoneName: string | null;
  };
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function setStatus(status: string) {
    setBusy(true);
    await fetch(`/api/v1/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="card p-3">
      <p className="text-sm font-medium leading-snug text-gray-900">
        {task.title}
      </p>
      {task.milestoneName && (
        <p className="mt-1 truncate text-xs text-gray-400">
          {task.milestoneName}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <StatusBadge status={task.priority} />
        {task.assigneeName && (
          <span
            className="truncate text-xs text-gray-500"
            title={task.assigneeName}
          >
            {task.assigneeName}
          </span>
        )}
      </div>
      {canManage && (
        <select
          className="mt-2 w-full rounded border border-gray-200 bg-gray-50 px-1.5 py-1 text-xs text-gray-600"
          value={task.status}
          disabled={busy}
          onChange={(e) => setStatus(e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
