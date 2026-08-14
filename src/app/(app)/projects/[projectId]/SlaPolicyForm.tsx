"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_SLA_POLICY,
  SLA_POLICY_FIELDS,
  type SlaPolicy,
  type SlaPolicyOverride,
} from "@/lib/sla";

type Draft = Record<keyof SlaPolicy, string>;

function toDraft(override: SlaPolicyOverride | null): Draft {
  return Object.fromEntries(
    SLA_POLICY_FIELDS.map((f) => [
      f.key,
      override?.[f.key] === undefined ? "" : String(override[f.key]),
    ]),
  ) as Draft;
}

/**
 * Per-project SLA thresholds. Blank inputs mean "inherit the org default" —
 * only the fields typed in are persisted, so a project keeps tracking defaults
 * for everything it hasn't deliberately tuned.
 */
export function SlaPolicyForm({
  projectId,
  override,
}: {
  projectId: string;
  override: SlaPolicyOverride | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(override));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const customCount = SLA_POLICY_FIELDS.filter(
    (f) => draft[f.key] !== "" && Number(draft[f.key]) !== DEFAULT_SLA_POLICY[f.key],
  ).length;

  async function send(body: SlaPolicyOverride) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch(`/api/v1/projects/${projectId}/sla-policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json()) as { override: SlaPolicyOverride | null };
      setDraft(toDraft(data.override));
      setSaved(true);
      setBusy(false);
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not save the policy");
      setBusy(false);
    }
  }

  function save() {
    const body: SlaPolicyOverride = {};
    for (const f of SLA_POLICY_FIELDS) {
      const raw = draft[f.key].trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      body[f.key] = n;
    }
    void send(body);
  }

  const groups = [...new Set(SLA_POLICY_FIELDS.map((f) => f.group))];

  return (
    <div className="card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">SLA policy</h2>
        {customCount > 0 ? (
          <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200">
            {customCount} custom
          </span>
        ) : (
          <span className="text-xs text-gray-500">Using org defaults</span>
        )}
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Thresholds that decide when this project shows as at risk or breached.
        Leave a field blank to inherit the org default.
      </p>

      <div className="space-y-4">
        {groups.map((group) => (
          <fieldset key={group}>
            <legend className="mb-1.5 text-xs font-medium text-gray-700">
              {group}
            </legend>
            <div className="space-y-2">
              {/* Stacked rather than side-by-side: this card sits in a narrow
                  column, where a horizontal label would wrap to one word a line. */}
              {SLA_POLICY_FIELDS.filter((f) => f.group === group).map((f) => (
                <label key={f.key} className="block">
                  <span className="block text-sm text-gray-600">{f.label}</span>
                  <span className="mt-1 flex items-center gap-2">
                    <input
                      type="number"
                      className="input w-24 text-right"
                      min={f.min}
                      max={f.max}
                      value={draft[f.key]}
                      placeholder={String(DEFAULT_SLA_POLICY[f.key])}
                      aria-label={f.label}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [f.key]: e.target.value }))
                      }
                    />
                    <span className="text-xs text-gray-500">{f.unit}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      {saved && !error && (
        <p className="mt-3 text-xs font-medium text-emerald-700" data-testid="sla-saved">
          SLA policy saved
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button className="btn-primary" disabled={busy} onClick={save}>
          {busy ? "Saving..." : "Save policy"}
        </button>
        <button
          className="btn-secondary"
          disabled={busy || customCount === 0}
          onClick={() => send({})}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
