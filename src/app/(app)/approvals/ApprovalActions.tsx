"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { REJECTION_REASONS as REASONS } from "./reasons";

export function ApprovalActions({
  approvalId,
  subjectType,
}: {
  approvalId: string;
  subjectType: "plan" | "customer_update";
}) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [reasonCode, setReasonCode] = useState<string>(REASONS[0].value);
  const [note, setNote] = useState("");
  const [regenerate, setRegenerate] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const reasonId = useId();
  const noteId = useId();

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    const key = idempotencyKey.current ?? crypto.randomUUID();
    idempotencyKey.current = key;
    const res = await fetch(`/api/v1/approvals/${approvalId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(
        decision === "approved"
          ? { decision, note: note || undefined }
          : {
              decision,
              reasonCode,
              note: note || undefined,
              regenerate: subjectType === "plan" ? regenerate : undefined,
            },
      ),
    });
    if (res.ok) {
      idempotencyKey.current = null;
      const data = (await res.json().catch(() => ({}))) as {
        regenerationJobId?: string;
      };
      if (data.regenerationJobId) {
        // Keep the confirmation up briefly, then refresh the queue.
        setDone("Rejected — generating a revised plan from your feedback…");
        setTimeout(() => router.refresh(), 1600);
      } else {
        router.refresh();
      }
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Decision failed");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700">
        {done}
      </p>
    );
  }

  if (!rejecting) {
    return (
      <div className="flex items-center gap-2">
        <button
          className="btn-primary"
          disabled={busy}
          onClick={() => decide("approved")}
        >
          {busy ? "Working..." : "Approve"}
        </button>
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={() => setRejecting(true)}
        >
          Reject...
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-red-100 bg-red-50/50 p-3">
      <div>
        <label className="label" htmlFor={reasonId}>Rejection reason</label>
        <select
          id={reasonId}
          className="input"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor={noteId}>Note (optional)</label>
        <textarea
          id={noteId}
          className="input"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What should change before the next version?"
        />
      </div>
      {subjectType === "plan" && (
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            checked={regenerate}
            onChange={(e) => setRegenerate(e.target.checked)}
          />
          <span>
            Automatically generate a revised plan
            <span className="block text-xs text-gray-500">
              Feeds this reason and note into a new version for review.
            </span>
          </span>
        </label>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          className="btn-danger"
          disabled={busy}
          onClick={() => decide("rejected")}
        >
          {busy ? "Working..." : "Confirm rejection"}
        </button>
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={() => setRejecting(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
