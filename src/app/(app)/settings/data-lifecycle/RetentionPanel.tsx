"use client";

import { useEffect, useMemo, useState } from "react";

type Policy = {
  auditDays: number;
  aiDetailDays: number;
  completedJobDays: number;
  webhookDeliveryDays: number;
};

const DEFAULT_POLICY: Policy = {
  auditDays: 365,
  aiDetailDays: 90,
  completedJobDays: 30,
  webhookDeliveryDays: 30,
};

const FIELDS: Array<{
  key: keyof Policy;
  label: string;
  min: number;
  max: number;
}> = [
  { key: "auditDays", label: "Audit events", min: 90, max: 2555 },
  { key: "aiDetailDays", label: "AI detail", min: 30, max: 365 },
  { key: "completedJobDays", label: "Completed jobs", min: 7, max: 90 },
  { key: "webhookDeliveryDays", label: "Webhook deliveries", min: 7, max: 90 },
];

const COUNT_LABELS: Record<string, string> = {
  auditEvents: "Audit events",
  aiCalls: "AI call details",
  aiEvaluations: "AI evaluations",
  completedJobs: "Completed jobs",
  webhookDeliveries: "Webhook deliveries",
};

function policyFromBody(value: unknown): Policy | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Policy>;
  if (!FIELDS.every(({ key }) => {
    const fieldValue = candidate[key];
    return typeof fieldValue === "number" && Number.isInteger(fieldValue);
  })) return null;
  return candidate as Policy;
}

export function RetentionPanel() {
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [savedPolicy, setSavedPolicy] = useState<Policy | null>(null);
  const [preview, setPreview] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "preview" | null>("load");
  const [message, setMessage] = useState<string | null>(null);
  const dirty = useMemo(
    () => Boolean(savedPolicy && JSON.stringify(policy) !== JSON.stringify(savedPolicy)),
    [policy, savedPolicy],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/retention-policy", { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { policy?: unknown; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Unable to load retention policy");
        const loaded = policyFromBody(body.policy);
        if (!loaded) throw new Error("Retention policy response was invalid");
        setPolicy(loaded);
        setSavedPolicy(loaded);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Unable to load retention policy");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(null);
      });
    return () => controller.abort();
  }, []);

  function update(field: (typeof FIELDS)[number], rawValue: string) {
    const parsed = Number(rawValue);
    const next = Number.isFinite(parsed) ? Math.max(field.min, Math.min(field.max, parsed)) : field.min;
    setPolicy((current) => ({ ...current, [field.key]: next }));
    setPreview(null);
    setMessage(null);
  }

  async function save() {
    setBusy("save");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/retention-policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(policy),
      });
      const body = (await response.json()) as { policy?: unknown; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to save retention policy");
      const saved = policyFromBody(body.policy) ?? policy;
      setPolicy(saved);
      setSavedPolicy(saved);
      setMessage("Retention policy saved and audited.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save retention policy");
    } finally {
      setBusy(null);
    }
  }

  async function loadPreview() {
    setBusy("preview");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/retention-policy/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(policy),
      });
      const body = (await response.json()) as { counts?: Record<string, number>; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to preview retention changes");
      setPreview(body.counts ?? {});
      setMessage(dirty ? "Previewed this unsaved draft; no records were deleted." : "Previewed the saved policy; no records were deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to preview retention changes");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_0.8fr]" aria-busy={Boolean(busy)}>
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-950">Retention windows</h2>
          {dirty ? <span className="badge badge-amber">Unsaved changes</span> : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {FIELDS.map((field) => (
            <label key={field.key} className="label">
              {field.label}
              <span className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  className="input min-w-0"
                  value={policy[field.key]}
                  disabled={busy === "load"}
                  onChange={(event) => update(field, event.target.value)}
                />
                <span className="text-xs text-slate-500">days</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={Boolean(busy) || !dirty} onClick={() => void save()}>
            {busy === "save" ? "Saving…" : "Save policy"}
          </button>
          <button type="button" className="btn-secondary" disabled={Boolean(busy)} onClick={() => void loadPreview()}>
            {busy === "preview" ? "Previewing…" : "Preview changes"}
          </button>
        </div>
        {message ? <p className="mt-3 text-sm text-slate-600" role="status">{message}</p> : null}
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-950">Deletion preview</h2>
        {preview ? (
          <>
            <p className="mt-2 text-xs leading-5 text-slate-500">Read-only count for the values currently shown in the form.</p>
            <dl className="mt-4 space-y-3">
              {Object.entries(preview).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-slate-600">{COUNT_LABELS[key] ?? key}</dt>
                  <dd className="font-semibold tabular-nums text-slate-950">{value}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Preview the draft before saving to see bounded record counts. Previewing never deletes data.
          </p>
        )}
      </section>
    </div>
  );
}
