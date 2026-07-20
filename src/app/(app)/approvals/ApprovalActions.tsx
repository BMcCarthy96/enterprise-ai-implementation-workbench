"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const REASONS = [
  { value: "scope_too_broad", label: "Scope too broad" },
  { value: "scope_too_narrow", label: "Scope too narrow" },
  { value: "inaccurate_content", label: "Inaccurate content" },
  { value: "wrong_sequencing", label: "Wrong sequencing" },
  { value: "estimates_unrealistic", label: "Estimates unrealistic" },
  { value: "tone_inappropriate", label: "Tone inappropriate" },
  { value: "other", label: "Other" },
];

export function ApprovalActions({ approvalId }: { approvalId: string }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [reasonCode, setReasonCode] = useState(REASONS[0].value);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/approvals/${approvalId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        decision === "approved"
          ? { decision, note: note || undefined }
          : { decision, reasonCode, note: note || undefined },
      ),
    });
    if (res.ok) {
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Decision failed");
      setBusy(false);
    }
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
        <label className="label">Rejection reason</label>
        <select
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
        <label className="label">Note (optional)</label>
        <textarea
          className="input"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What should change before the next version?"
        />
      </div>
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
