"use client";

import { useEffect, useMemo, useState } from "react";

type Operation = { summary?: string; description?: string; tags?: string[]; responses?: Record<string, { description?: string }> };
type OpenApiDocument = { info?: { version?: string }; paths?: Record<string, Record<string, Operation>> };

export function ApiExplorer() {
  const [document, setDocument] = useState<OpenApiDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/openapi.json")
      .then(async (response) => {
        if (!response.ok) throw new Error("The API contract could not be loaded");
        return (await response.json()) as OpenApiDocument;
      })
      .then((value) => { if (!cancelled) setDocument(value); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "The API contract could not be loaded"); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => Object.entries(document?.paths ?? {}).flatMap(([path, methods]) => Object.entries(methods).map(([method, operation]) => ({ path, method: method.toUpperCase(), operation }))).filter((row) => {
    const haystack = `${row.method} ${row.path} ${row.operation.summary ?? ""} ${(row.operation.tags ?? []).join(" ")}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [document, query]);

  return <section className="space-y-4" aria-labelledby="api-explorer-heading">
    <div className="card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="api-explorer-heading" className="text-sm font-semibold text-slate-950">Read-only API explorer</h2><p className="mt-1 text-sm leading-6 text-slate-600">Browse the generated contract used by the Workbench. This surface never executes mutations.</p></div><a href="/api/openapi.json" target="_blank" rel="noreferrer" className="btn-secondary text-xs">Open raw OpenAPI ↗</a></div><label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">Filter routes<input className="input mt-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. approvals, webhooks, projects" /></label></div>
    {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</p>}
    {!document && !error && <p className="card px-4 py-8 text-center text-sm text-slate-500" role="status">Loading API contract…</p>}
    {document && <div className="card overflow-hidden"><div className="border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-500">Contract v{document.info?.version ?? "unknown"} · {rows.length} matching operations</div><div className="divide-y divide-slate-100">{rows.map(({ path, method, operation }) => <details key={`${method}-${path}`} className="group px-5 py-3"><summary className="flex cursor-pointer list-none flex-wrap items-center gap-3"><span className={`rounded px-2 py-1 text-[10px] font-bold ${method === "GET" ? "bg-emerald-50 text-emerald-700" : method === "POST" ? "bg-indigo-50 text-indigo-700" : method === "DELETE" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{method}</span><code className="text-xs text-slate-800">{path}</code><span className="min-w-0 flex-1 text-xs text-slate-500">{operation.summary ?? "No summary"}</span><span aria-hidden className="text-slate-400 transition group-open:rotate-90">›</span></summary><div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><p>{(operation.tags ?? []).join(" · ") || "Uncategorized"}</p><p className="mt-2">Responses: {Object.entries(operation.responses ?? {}).map(([status, response]) => `${status} ${response.description ?? ""}`).join(" · ") || "not documented"}</p></div></details>)}{rows.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-500">No routes match that filter.</p>}</div></div>}
  </section>;
}
