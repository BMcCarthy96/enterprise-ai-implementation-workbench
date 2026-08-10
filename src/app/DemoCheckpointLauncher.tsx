"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function DemoCheckpointLauncher() {
  const router = useRouter();
  const params = useSearchParams();
  const checkpoint = params.get("checkpoint") ?? "portfolio-health";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function launch() {
      try {
        const response = await fetch("/api/demo/session", { method: "POST" });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Demo is temporarily unavailable");
        if (!cancelled) router.replace("/dashboard?checkpoint=" + encodeURIComponent(checkpoint));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Demo is temporarily unavailable");
      }
    }
    void launch();
    return () => {
      cancelled = true;
    };
  }, [checkpoint, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07111f] px-6 text-white">
      <div className="max-w-md text-center">
        {error ? (
          <>
            <p className="text-sm text-rose-300">{error}</p>
            <button className="btn-demo mt-5" onClick={() => router.refresh()}>Try again</button>
          </>
        ) : (
          <>
            <div className="mx-auto h-10 w-10 animate-pulse rounded-2xl bg-cyan-300" />
            <h1 className="mt-6 text-2xl font-semibold">Preparing a private demo checkpoint</h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">Synthetic data only. The workspace is isolated and expires automatically.</p>
          </>
        )}
      </div>
    </main>
  );
}
