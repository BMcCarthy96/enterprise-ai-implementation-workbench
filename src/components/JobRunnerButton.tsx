"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "queued" | "running" | "done" | "error";

/**
 * Generic async-job trigger: POSTs to an endpoint that returns { jobId },
 * then polls the jobs API until the job reaches a terminal state and
 * refreshes the page data. Used for plan generation and update digests.
 */
export function JobRunnerButton({
  endpoint,
  label,
  busyLabel,
  className = "btn-primary",
}: {
  endpoint: string;
  label: string;
  busyLabel: string;
  className?: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function poll(jobId: string): Promise<void> {
    const res = await fetch(`/api/v1/jobs?limit=50`);
    if (!res.ok) {
      setPhase("error");
      setError("Could not check job status");
      return;
    }
    const data = (await res.json()) as {
      jobs: Array<{ id: string; status: string; lastError: string | null }>;
    };
    const job = data.jobs.find((j) => j.id === jobId);
    if (!job || job.status === "queued") {
      setPhase("queued");
    } else if (job.status === "running" || job.status === "failed") {
      // "failed" here means a retry is pending — keep waiting.
      setPhase("running");
    } else if (job.status === "succeeded") {
      setPhase("done");
      router.refresh();
      timer.current = setTimeout(() => setPhase("idle"), 2500);
      return;
    } else if (job.status === "dead_letter") {
      setPhase("error");
      setError(job.lastError ?? "Job failed after all retries");
      return;
    }
    timer.current = setTimeout(() => poll(jobId), 1500);
  }

  async function start() {
    setPhase("queued");
    setError(null);
    const res = await fetch(endpoint, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setPhase("error");
      setError(data?.error ?? "Request failed");
      return;
    }
    const { jobId } = (await res.json()) as { jobId: string };
    poll(jobId);
  }

  const busy = phase === "queued" || phase === "running";
  return (
    <div className="flex flex-col items-end gap-1">
      <button className={className} onClick={start} disabled={busy}>
        {busy ? busyLabel : phase === "done" ? "Done ✓" : label}
      </button>
      {busy && (
        <span className="text-xs text-gray-400">
          {phase === "queued" ? "Waiting for worker..." : "Processing..."}
        </span>
      )}
      {phase === "error" && error && (
        <span className="max-w-xs text-right text-xs text-red-600">{error}</span>
      )}
    </div>
  );
}
