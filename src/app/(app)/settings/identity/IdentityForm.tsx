"use client";

import { useCallback, useEffect, useState } from "react";

type Connection = {
  id: string;
  slug: string;
  issuerUrl: string;
  clientId: string;
  enabled: boolean;
  jitEnabled: boolean;
  allowedDomains: string[];
  groupMappings: Record<string, string>;
};

const EMPTY_FORM = {
  slug: "",
  issuerUrl: "",
  clientId: "",
  clientSecret: "",
  allowedDomains: "",
  groupMappings: "{}",
  enabled: false,
  jitEnabled: false,
};

export function IdentityForm() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState<"load" | "create" | string | null>("load");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/identity-connections");
    const body = (await response.json()) as { connections?: Connection[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Unable to load identity providers");
    setConnections(body.connections ?? []);
  }, []);

  useEffect(() => {
    // Server-backed settings intentionally hydrate after the client boundary mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load identity providers"))
      .finally(() => setBusy(null));
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setMessage(null);
    try {
      const groupMappings = JSON.parse(form.groupMappings) as Record<string, string>;
      if (!groupMappings || typeof groupMappings !== "object" || Array.isArray(groupMappings)) {
        throw new Error("Group mappings must be a JSON object");
      }
      const response = await fetch("/api/v1/identity-connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          allowedDomains: form.allowedDomains.split(",").map((value) => value.trim()).filter(Boolean),
          groupMappings,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to save connection");
      setMessage("Connection saved. The client secret is encrypted and will not be shown again.");
      setForm(EMPTY_FORM);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save connection");
    } finally {
      setBusy(null);
    }
  }

  async function toggle(connection: Connection) {
    if (connection.enabled && !window.confirm(`Disable ${connection.slug}? Users will no longer be able to start new SSO sessions through it.`)) return;
    setBusy(connection.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/identity-connections/${connection.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !connection.enabled }),
      });
      const body = response.status === 204 ? {} : await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to update connection");
      await load();
      setMessage(`${connection.slug} ${connection.enabled ? "disabled" : "enabled"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update connection");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5" aria-busy={Boolean(busy)}>
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-950">Configured providers</h2>
        <div className="mt-4 space-y-3">
          {connections.map((connection) => (
            <div key={connection.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-slate-900">{connection.slug}</p>
                  <span className={connection.enabled ? "badge badge-green" : "badge bg-slate-100 text-slate-600"}>{connection.enabled ? "Enabled" : "Disabled"}</span>
                </div>
                <p className="mt-1 break-all text-xs text-slate-500">{connection.issuerUrl}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {Object.keys(connection.groupMappings ?? {}).length} role mappings · {connection.jitEnabled ? "JIT on" : "JIT off"}
                </p>
              </div>
              <button
                type="button"
                className={connection.enabled ? "btn-secondary text-rose-700" : "btn-primary"}
                disabled={Boolean(busy)}
                onClick={() => void toggle(connection)}
              >
                {busy === connection.id ? "Updating…" : connection.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          ))}
          {busy === "load" ? <p className="text-sm text-slate-500">Loading providers…</p> : null}
          {busy !== "load" && connections.length === 0 ? (
            <p className="text-sm text-slate-500">No OIDC provider configured. Password login remains available.</p>
          ) : null}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-950">Add provider</h2>
        <form className="mt-4" onSubmit={submit}>
          <fieldset className="grid gap-3 md:grid-cols-2" disabled={busy === "create"}>
            <label className="label">Slug<input required className="input mt-1" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="corporate-idp" /></label>
            <label className="label">Issuer URL<input required type="url" className="input mt-1 min-w-0" value={form.issuerUrl} onChange={(event) => setForm({ ...form, issuerUrl: event.target.value })} placeholder="https://idp.example.com" /></label>
            <label className="label">Client ID<input required className="input mt-1" value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })} /></label>
            <label className="label">Client secret<input type="password" className="input mt-1" value={form.clientSecret} onChange={(event) => setForm({ ...form, clientSecret: event.target.value })} autoComplete="new-password" /></label>
            <label className="label">Allowed domains<input className="input mt-1" value={form.allowedDomains} onChange={(event) => setForm({ ...form, allowedDomains: event.target.value })} placeholder="example.com, customer.example" /></label>
            <label className="label">Group mappings (JSON)<input className="input mt-1 min-w-0 font-mono" value={form.groupMappings} onChange={(event) => setForm({ ...form, groupMappings: event.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> Enable connection</label>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.jitEnabled} onChange={(event) => setForm({ ...form, jitEnabled: event.target.checked })} /> Enable JIT provisioning</label>
            <div className="flex flex-wrap items-center gap-3 md:col-span-2">
              <button className="btn-primary" type="submit">{busy === "create" ? "Saving…" : "Save OIDC connection"}</button>
            </div>
          </fieldset>
        </form>
        {message ? <p className="mt-3 text-sm text-slate-600" role="status">{message}</p> : null}
      </section>
    </div>
  );
}
