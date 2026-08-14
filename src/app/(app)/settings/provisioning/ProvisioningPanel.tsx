"use client";

import { useEffect, useState } from "react";

type Token = {
  id: string;
  label: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function ProvisioningPanel() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [label, setLabel] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>("load");
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const response = await fetch("/api/v1/scim-tokens");
    const body = (await response.json().catch(() => ({}))) as { tokens?: Token[]; error?: string };
    if (response.ok) setTokens(body.tokens ?? []);
    else setMessage(body.error ?? "Unable to load SCIM tokens");
  };

  // The effect intentionally hydrates server-backed tokens after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load().finally(() => setBusy(null)); }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy || plaintext) return;
    setBusy("create");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/scim-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const body = (await response.json().catch(() => ({}))) as { plaintext?: string; error?: string };
      if (!response.ok || !body.plaintext) {
        setMessage(body.error ?? "Unable to issue token");
        return;
      }
      setPlaintext(body.plaintext);
      setLabel("");
      setMessage("Copy this token now. It will not be shown again.");
      await load();
    } catch {
      setMessage("Unable to issue token");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(token: Token) {
    if (busy) return;
    if (!window.confirm(`Revoke the SCIM token “${token.label}”? Provisioning requests using it will fail immediately.`)) return;
    setBusy(`revoke:${token.id}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/scim-tokens/${token.id}`, { method: "DELETE" });
      if (response.ok) {
        setMessage("SCIM token revoked.");
        await load();
      } else {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setMessage(body.error ?? "Unable to revoke token");
      }
    } catch {
      setMessage("Unable to revoke token");
    } finally {
      setBusy(null);
    }
  }

  async function copyToken() {
    if (!plaintext) return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(plaintext);
      setMessage("SCIM token copied. Store it securely before dismissing it.");
    } catch {
      setMessage("Select and copy the SCIM token manually before dismissing it.");
    }
  }

  return (
    <div className="space-y-5" aria-busy={Boolean(busy)}>
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">SCIM endpoint</h2>
            <p className="mt-1 text-sm text-slate-600"><code>/api/scim/v2</code> · Bearer tokens are hashed at rest and scoped to this organization.</p>
          </div>
          <span className="badge badge-green">{tokens.filter((token) => !token.revokedAt).length} active</span>
        </div>

        {plaintext && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4" role="alert">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">One-time secret</p>
            <code className="mt-2 block break-all rounded bg-white p-2 text-xs text-amber-950">{plaintext}</code>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => void copyToken()}>Copy token</button>
              <button type="button" className="btn-secondary" onClick={() => setPlaintext(null)}>I&apos;ve saved it</button>
            </div>
          </div>
        )}

        <form className="mt-5 flex flex-wrap items-end gap-3" onSubmit={create}>
          <label className="label w-full sm:w-auto sm:min-w-64">Token label
            <input required className="input mt-1" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Okta directory" />
          </label>
          <button className="btn-primary w-full sm:w-auto" type="submit" disabled={Boolean(busy || plaintext)}>
            {busy === "create" ? "Issuing token…" : plaintext ? "Save current token first" : "Issue SCIM token"}
          </button>
        </form>
        {message && <p className="mt-3 text-sm text-slate-600" role="status">{message}</p>}
      </section>

      <section className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead><tr><th className="table-th">Label</th><th className="table-th">Created</th><th className="table-th">Last used</th><th className="table-th">State</th><th className="table-th" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {tokens.map((token) => (
              <tr key={token.id}>
                <td className="table-td font-medium text-slate-900">{token.label}</td>
                <td className="table-td text-xs">{new Date(token.createdAt).toLocaleDateString()}</td>
                <td className="table-td text-xs">{token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : "Not used"}</td>
                <td className="table-td"><span className={token.revokedAt ? "badge" : "badge badge-green"}>{token.revokedAt ? "Revoked" : "Active"}</span></td>
                <td className="table-td text-right">
                  {!token.revokedAt && (
                    <button type="button" className="btn-secondary text-rose-700" disabled={Boolean(busy)} onClick={() => void revoke(token)}>
                      {busy === `revoke:${token.id}` ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
