"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  buildDemoDestination,
  parseDemoEntry,
} from "@/lib/demoEntry";

export function DemoCheckpointLauncher() {
  const router = useRouter();
  const params = useSearchParams();
  const { checkpoint, persona, tourMode } = parseDemoEntry(params);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const launchRef = useRef<{ key: string; promise: Promise<string> } | null>(null);

  useEffect(() => {
    let active = true;
    const entryKey = `${tourMode}:${checkpoint ?? "none"}:${persona ?? "default"}:${attempt}`;

    if (launchRef.current?.key !== entryKey) {
      launchRef.current = {
        key: entryKey,
        promise: (async () => {
          const response = await fetch("/api/demo/session", { method: "POST" });
          const body = await response.json().catch(() => null);
          if (!response.ok) throw new Error(body?.error ?? "Demo is temporarily unavailable");

          if (persona) {
            const roleResponse = await fetch("/api/demo/role", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ role: persona, returnTo: "/dashboard" }),
            });
            const roleBody = await roleResponse.json().catch(() => null);
            if (!roleResponse.ok) {
              throw new Error(roleBody?.error ?? "The requested demo view is temporarily unavailable");
            }
          }

          return buildDemoDestination({ checkpoint, tourMode });
        })(),
      };
    }

    void launchRef.current.promise
      .then((destination) => {
        if (active) router.replace(destination);
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Demo is temporarily unavailable");
        }
      });

    return () => {
      active = false;
    };
  }, [attempt, checkpoint, persona, router, tourMode]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07111f] px-6 text-white">
      <div className="max-w-md text-center">
        {error ? (
          <>
            <p className="text-sm text-rose-300">{error}</p>
            <button
              className="btn-demo mt-5"
              onClick={() => {
                setError(null);
                setAttempt((current) => current + 1);
              }}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto h-10 w-10 animate-pulse rounded-2xl bg-cyan-300" />
            <h1 className="mt-6 text-2xl font-semibold">
              {tourMode === "self-guided"
                ? "Preparing a private demo workspace"
                : "Preparing a private demo checkpoint"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">Synthetic data only. The workspace is isolated and expires automatically.</p>
          </>
        )}
      </div>
    </main>
  );
}
