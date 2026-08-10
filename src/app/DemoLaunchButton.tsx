"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DemoLaunchButton({ checkpoint }: { checkpoint?: string } = {}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/demo/session", { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Demo is temporarily unavailable");
      router.push(checkpoint ? "/dashboard?checkpoint=" + encodeURIComponent(checkpoint) : "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo is temporarily unavailable");
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn-demo" onClick={launch} disabled={busy}>
        {busy ? "Preparing a private workspace…" : "Launch interactive demo"}
        {!busy && <span aria-hidden="true">→</span>}
      </button>
      {error && <p className="mt-2 text-xs text-rose-200">{error}</p>}
    </div>
  );
}
