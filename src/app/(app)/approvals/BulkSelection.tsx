"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { REJECTION_REASONS } from "./reasons";

export interface BulkItem {
  id: string;
  subjectType: "plan" | "customer_update";
}

interface Ctx {
  items: BulkItem[];
  selected: Set<string>;
  toggle: (id: string) => void;
  busy: boolean;
}

const BulkCtx = createContext<Ctx | null>(null);

function useBulk(): Ctx {
  const ctx = useContext(BulkCtx);
  if (!ctx) throw new Error("Bulk components must be inside BulkSelectionProvider");
  return ctx;
}

/**
 * Shares selection state between the per-card checkboxes and the action bar so
 * the approval cards themselves can stay server-rendered (they carry plan and
 * update previews we don't want to ship to the client).
 */
export function BulkSelectionProvider({
  items,
  children,
}: {
  items: BulkItem[];
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy] = useState(false);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ items, selected, toggle, busy }),
    [items, selected, toggle, busy],
  );

  return (
    <BulkCtx.Provider value={value}>
      <BulkInner setSelected={setSelected}>{children}</BulkInner>
    </BulkCtx.Provider>
  );
}

// Separated so the bar can reset selection after a successful submit.
const SetSelectedCtx = createContext<
  React.Dispatch<React.SetStateAction<Set<string>>>
>(() => {});

function BulkInner({
  setSelected,
  children,
}: {
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  children: React.ReactNode;
}) {
  return (
    <SetSelectedCtx.Provider value={setSelected}>
      {children}
    </SetSelectedCtx.Provider>
  );
}

/** Per-card selection checkbox. */
export function ApprovalCheckbox({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const { selected, busy } = useBulk();
  const { toggle } = useBulk();
  return (
    <input
      type="checkbox"
      className="h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
      checked={selected.has(id)}
      disabled={busy}
      onChange={() => toggle(id)}
      aria-label={`Select ${label}`}
    />
  );
}

/**
 * Select-all + bulk approve/reject. Reports partial outcomes verbatim from the
 * API so a stale selection ("already decided") is visible rather than silent.
 */
export function BulkActionBar() {
  const { items, selected } = useBulk();
  const setSelected = useContext(SetSelectedCtx);
  const router = useRouter();

  const [rejecting, setRejecting] = useState(false);
  const [reasonCode, setReasonCode] = useState<string>(REJECTION_REASONS[0].value);
  const [note, setNote] = useState("");
  const [regenerate, setRegenerate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  const count = selected.size;
  const allSelected = count > 0 && count === items.length;
  const anyPlans = items.some((i) => selected.has(i.id) && i.subjectType === "plan");

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  }

  async function submit(decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    const key = idempotencyKey.current ?? crypto.randomUUID();
    idempotencyKey.current = key;
    const res = await fetch("/api/v1/approvals/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({
        approvalIds: [...selected],
        decision,
        ...(decision === "rejected"
          ? {
              reasonCode,
              note: note || undefined,
              regenerate: anyPlans ? regenerate : undefined,
            }
          : { note: note || undefined }),
      }),
    });

    if (res.ok) {
      idempotencyKey.current = null;
      const data = (await res.json().catch(() => ({}))) as { summary?: string };
      setSummary(data.summary ?? "Done");
      setSelected(new Set());
      setRejecting(false);
      setBusy(false);
      // Let the outcome register before the list re-renders without the items.
      setTimeout(() => router.refresh(), 1200);
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Bulk decision failed");
      setBusy(false);
    }
  }

  if (items.length === 0) return null;

  return (
    <div className="card mb-4 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            checked={allSelected}
            onChange={toggleAll}
            aria-label="Select all approvals"
          />
          Select all
        </label>
        <span className="text-sm text-gray-500" data-testid="bulk-count">
          {count} selected
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="btn-primary"
            disabled={count === 0 || busy}
            onClick={() => submit("approved")}
          >
            {busy && !rejecting ? "Working..." : "Approve selected"}
          </button>
          <button
            className="btn-secondary"
            disabled={count === 0 || busy}
            onClick={() => setRejecting((v) => !v)}
          >
            Reject selected...
          </button>
        </div>
      </div>

      {summary && (
        <p
          className="mt-3 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700"
          data-testid="bulk-summary"
        >
          {summary}
        </p>
      )}

      {rejecting && (
        <div className="mt-3 space-y-2 rounded-md border border-red-100 bg-red-50/50 p-3">
          <div>
            <label className="label">Rejection reason (applies to all selected)</label>
            <select
              className="input"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
            >
              {REJECTION_REASONS.map((r) => (
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
          {anyPlans && (
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                checked={regenerate}
                onChange={(e) => setRegenerate(e.target.checked)}
              />
              <span>
                Automatically generate revised plans
                <span className="block text-xs text-gray-400">
                  Applies to selected plans; customer updates are unaffected.
                </span>
              </span>
            </label>
          )}
          <button
            className="btn-danger"
            disabled={busy}
            onClick={() => submit("rejected")}
          >
            {busy ? "Working..." : `Confirm rejection of ${count}`}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
