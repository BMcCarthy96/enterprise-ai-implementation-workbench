"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DemoLaunchButtonProps {
  checkpoint?: string;
  label?: string;
  busyLabel?: string;
  className?: string;
  errorClassName?: string;
}

export function DemoLaunchButton({
  checkpoint,
  label = "Start 90-second tour",
  busyLabel = "Preparing a private workspace…",
  className = "btn-demo",
  errorClassName = "mt-2 text-xs text-rose-200",
}: DemoLaunchButtonProps = {}) {
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
      <button type="button" className={className} onClick={launch} disabled={busy}>
        {busy ? busyLabel : label}
        {!busy && <span aria-hidden="true">→</span>}
      </button>
      {error && <p className={errorClassName} role="alert" aria-live="assertive">{error}</p>}
    </div>
  );
}
