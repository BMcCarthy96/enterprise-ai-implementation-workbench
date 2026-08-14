"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Endpoint = {
  id: string;
  url: string;
  eventTypes: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type Delivery = {
  id: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

const EVENTS = [
  "approval.decided",
  "customer_update.published",
  "task.status_changed",
  "job.dead_letter",
  "webhook.test",
];

export function IntegrationsPanel() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [url, setUrl] = useState("");
  const [eventType, setEventType] = useState(EVENTS[0]);
  const [secret, setSecret] = useState<{ value: string; title: string } | null>(null);
  const [busy, setBusy] = useState<string | null>("load");
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/webhooks");
    const body = (await response.json().catch(() => ({}))) as { endpoints?: Endpoint[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Unable to load webhook endpoints");
    setEndpoints(body.endpoints ?? []);
  }, []);

  useEffect(() => {
    // Server-backed settings intentionally hydrate after the client boundary mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load webhook endpoints"))
      .finally(() => setBusy(null));
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy || secret) return;
    setBusy("create");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/webhooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, eventTypes: [eventType] }),
      });
      const body = (await response.json().catch(() => ({}))) as { secret?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to create webhook");
      if (!body.secret) throw new Error("Webhook created, but its one-time signing secret was not returned");
      setSecret({ value: body.secret, title: "New endpoint signing secret" });
      setUrl("");
      setMessage("Copy the signing secret now. It will not be shown again.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create webhook");
    } finally {
      setBusy(null);
    }
  }

  async function queueTest(endpointId: string) {
    if (busy) return;
    setBusy(`test:${endpointId}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/webhooks/${endpointId}/test`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to queue test delivery");
      setMessage("Test delivery queued through the durable worker. Open delivery history to inspect the result.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to queue test delivery");
    } finally {
      setBusy(null);
    }
  }

  async function loadHistory(endpointId: string) {
    setBusy(`history:${endpointId}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/webhooks/${endpointId}/deliveries?limit=10`);
      const body = (await response.json().catch(() => ({}))) as { deliveries?: Delivery[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load delivery history");
      setDeliveries((current) => ({ ...current, [endpointId]: body.deliveries ?? [] }));
      setExpandedEndpoint(endpointId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load delivery history");
    } finally {
      setBusy(null);
    }
  }

  async function rotateSecret(endpoint: Endpoint) {
    if (busy || secret) return;
    if (!window.confirm(`Rotate the signing secret for ${endpoint.url}? Existing consumers will stop verifying new deliveries until updated.`)) return;
    setBusy(`rotate:${endpoint.id}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/webhooks/${endpoint.id}/rotate-secret`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { secret?: string; error?: string };
      if (!response.ok || !body.secret) throw new Error(body.error ?? "Unable to rotate signing secret");
      setSecret({ value: body.secret, title: "Rotated endpoint signing secret" });
      setMessage("Secret rotated. Copy the replacement before dismissing it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to rotate signing secret");
    } finally {
      setBusy(null);
    }
  }

  async function remove(endpoint: Endpoint) {
    if (busy) return;
    if (!window.confirm(`Delete ${endpoint.url}? Future events will no longer be delivered to this endpoint.`)) return;
    setBusy(`delete:${endpoint.id}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/webhooks/${endpoint.id}`, { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to delete endpoint");
      setExpandedEndpoint((current) => current === endpoint.id ? null : current);
      setDeliveries((current) => {
        const next = { ...current };
        delete next[endpoint.id];
        return next;
      });
      await load();
      setMessage("Webhook endpoint deleted and the change was audited.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete endpoint");
    } finally {
      setBusy(null);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(secret.value);
      setMessage("Signing secret copied. Store it in your secret manager before dismissing it.");
    } catch {
      setMessage("Select and copy the signing secret manually before dismissing it.");
    }
  }

  return (
    <div className="space-y-5" aria-busy={Boolean(busy)}>
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-slate-950">Register endpoint</h2>
        {secret ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4" role="alert">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">{secret.title}</p>
            <p className="mt-1 text-xs leading-5 text-amber-900/80">Use this value to verify signatures. It cannot be retrieved after dismissal.</p>
            <code data-testid="webhook-signing-secret" className="mt-2 block break-all rounded bg-white p-2 text-xs text-amber-950">{secret.value}</code>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => void copySecret()}>Copy secret</button>
              <button type="button" className="btn-secondary" onClick={() => setSecret(null)}>I&apos;ve saved it</button>
            </div>
          </div>
        ) : null}
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={create}>
          <label className="label w-full sm:w-auto sm:min-w-72">HTTPS endpoint
            <input required type="url" className="input mt-1" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.test/workbench" />
          </label>
          <label className="label w-full sm:w-auto">Event
            <select className="input mt-1" value={eventType} onChange={(event) => setEventType(event.target.value)}>
              {EVENTS.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <button className="btn-primary w-full sm:w-auto" type="submit" disabled={Boolean(busy || secret)}>
            {busy === "create" ? "Adding endpoint…" : secret ? "Save current secret first" : "Add endpoint"}
          </button>
        </form>
        {message ? <p className="mt-3 text-sm text-slate-600" role="status">{message}</p> : null}
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-sm font-semibold text-slate-950">Configured endpoints</h2><p className="mt-1 text-xs text-slate-500">Signed delivery, rotation, bounded history, and retry evidence are available from one surface.</p></div>
          <Link href="/ops" className="btn-secondary text-xs">Open Operations</Link>
        </div>
        <div className="mt-4 space-y-3">
          {endpoints.map((endpoint) => (
            <div key={endpoint.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="break-all font-medium text-slate-900 sm:truncate">{endpoint.url}</p>
                  <p className="mt-1 text-xs text-slate-500">{endpoint.eventTypes.join(" · ")} · {endpoint.enabled ? "Enabled" : "Disabled"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary" disabled={Boolean(busy)} onClick={() => void queueTest(endpoint.id)}>{busy === `test:${endpoint.id}` ? "Queueing…" : "Queue test"}</button>
                  <button type="button" className="btn-secondary" disabled={Boolean(busy)} onClick={() => void loadHistory(endpoint.id)}>{busy === `history:${endpoint.id}` ? "Loading…" : expandedEndpoint === endpoint.id ? "Refresh history" : "Delivery history"}</button>
                  <button type="button" className="btn-secondary" disabled={Boolean(busy || secret)} onClick={() => void rotateSecret(endpoint)}>{busy === `rotate:${endpoint.id}` ? "Rotating…" : "Rotate secret"}</button>
                  <button type="button" className="btn-secondary text-rose-700" disabled={Boolean(busy)} onClick={() => void remove(endpoint)}>{busy === `delete:${endpoint.id}` ? "Deleting…" : "Delete"}</button>
                </div>
              </div>

              {expandedEndpoint === endpoint.id ? (
                <div className="mt-4 overflow-x-auto border-t border-slate-100 pt-4">
                  <div className="mb-3 flex justify-end"><button type="button" className="text-xs font-semibold text-slate-500 hover:text-slate-900" onClick={() => setExpandedEndpoint(null)}>Hide history</button></div>
                  {(deliveries[endpoint.id] ?? []).length ? (
                    <table className="min-w-full text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="pr-4 pb-2">Event</th><th className="pr-4 pb-2">State</th><th className="pr-4 pb-2">Attempts</th><th className="pr-4 pb-2">Response</th><th className="pb-2">Created</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {deliveries[endpoint.id].map((delivery) => (
                          <tr key={delivery.id}>
                            <td className="whitespace-nowrap py-2 pr-4 font-mono text-slate-700">{delivery.eventType}</td>
                            <td className="py-2 pr-4"><span className={delivery.status === "delivered" ? "badge badge-green" : delivery.status === "failed" ? "badge badge-amber" : "badge bg-slate-100 text-slate-600"}>{delivery.status}</span>{delivery.lastError ? <p className="mt-1 max-w-64 text-[10px] text-rose-700">{delivery.lastError}</p> : null}</td>
                            <td className="py-2 pr-4 tabular-nums text-slate-600">{delivery.attempts}</td>
                            <td className="py-2 pr-4 tabular-nums text-slate-600">{delivery.responseStatus ?? "—"}</td>
                            <td className="whitespace-nowrap py-2 text-slate-500">{new Date(delivery.createdAt).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="text-sm text-slate-500">No attempts recorded yet. Queue a test, then refresh delivery history.</p>}
                </div>
              ) : null}
            </div>
          ))}
          {busy === "load" ? <p className="text-sm text-slate-500">Loading endpoints…</p> : null}
          {busy !== "load" && endpoints.length === 0 ? <p className="text-sm text-slate-500">No endpoints registered yet.</p> : null}
        </div>
      </section>
    </div>
  );
}
