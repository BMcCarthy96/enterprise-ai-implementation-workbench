"use client";

import { useEffect, useState } from "react";

type Endpoint = { id: string; url: string; eventTypes: string[]; enabled: boolean; createdAt: string; updatedAt: string };
const events = ["approval.decided", "customer_update.published", "job.dead_letter", "webhook.test"];
export function IntegrationsPanel() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]); const [url, setUrl] = useState(""); const [eventType, setEventType] = useState(events[0]); const [message, setMessage] = useState<string | null>(null);
  const load = async () => { const response = await fetch("/api/v1/webhooks"); const body = await response.json(); if (response.ok) setEndpoints(body.endpoints ?? []); };
  // The effect intentionally hydrates server-backed endpoints after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);
  async function create(event: React.FormEvent) { event.preventDefault(); const response = await fetch("/api/v1/webhooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, eventTypes: [eventType] }) }); const body = await response.json(); setMessage(response.ok ? "Webhook created. The signing secret is shown once by the API response." : body.error ?? "Unable to create webhook"); if (response.ok) { setUrl(""); await load(); } }
  async function test(id: string) { const response = await fetch(`/api/v1/webhooks/${id}/test`, { method: "POST" }); setMessage(response.ok ? "Test delivery queued. Inspect Operations for attempts." : "Unable to queue test delivery"); }
  return <div className="space-y-5"><section className="card p-5"><h2 className="text-sm font-semibold text-slate-950">Register endpoint</h2><form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={create}><label className="label min-w-72">HTTPS endpoint<input required type="url" className="input mt-1" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.test/workbench" /></label><label className="label">Event<select className="input mt-1" value={eventType} onChange={(event) => setEventType(event.target.value)}>{events.map((value) => <option key={value}>{value}</option>)}</select></label><button className="btn-primary" type="submit">Add endpoint</button></form>{message && <p className="mt-3 text-sm text-slate-600" role="status">{message}</p>}</section><section className="card p-5"><h2 className="text-sm font-semibold text-slate-950">Configured endpoints</h2><div className="mt-4 space-y-3">{endpoints.map((endpoint) => <div key={endpoint.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4"><div className="min-w-0"><p className="truncate font-medium text-slate-900">{endpoint.url}</p><p className="mt-1 text-xs text-slate-500">{endpoint.eventTypes.join(" · ")} · {endpoint.enabled ? "Enabled" : "Disabled"}</p></div><button type="button" className="btn-secondary" onClick={() => void test(endpoint.id)}>Queue test</button></div>)}{endpoints.length === 0 && <p className="text-sm text-slate-500">No endpoints registered yet.</p>}</div></section></div>;
}
