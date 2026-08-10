"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { TourManifest, TourProgress } from "@/lib/tour";
import type { Role } from "@/lib/auth/rbac";

interface DemoQuota {
  expiresAt: string;
  generations: { used: number; limit: number };
  uploads: { used: number; limit: number };
  storageBytes: { used: number; limit: number };
}

function quotaBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function AppShell({
  children,
  manifest,
  userId,
  role,
  demoQuota,
}: {
  children: React.ReactNode;
  manifest: TourManifest;
  userId: string;
  role: Role;
  demoQuota?: DemoQuota | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const storageKey = useMemo(
    () => `workbench:tour:${manifest.version}:${manifest.workspaceId ?? "org"}:${userId}:${manifest.role}`,
    [manifest.role, manifest.version, manifest.workspaceId, userId],
  );
  const autoOpenKey = useMemo(
    () => `workbench:tour:auto:${manifest.version}:${manifest.workspaceId ?? "org"}`,
    [manifest.version, manifest.workspaceId],
  );
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [switchingRole, setSwitchingRole] = useState<Role | null>(null);
  const [progress, setProgress] = useState<TourProgress>({
    version: manifest.version,
    completedStepIds: manifest.steps.filter((step) => step.complete).map((step) => step.id),
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const saved = raw ? (JSON.parse(raw) as TourProgress) : null;
      const initial = saved?.version === manifest.version ? saved : {
        version: manifest.version,
        completedStepIds: manifest.steps.filter((step) => step.complete).map((step) => step.id),
      };
      // This effect hydrates client-only localStorage state after SSR.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgress(initial);
      const autoOpened = manifest.isDemo && window.localStorage.getItem(autoOpenKey) === "true";
      if (manifest.isDemo && !autoOpened && !initial.dismissed) {
        setOpen(true);
        setProgress((current) => ({ ...current, autoOpened: true }));
        window.localStorage.setItem(autoOpenKey, "true");
      }
    } catch {
      // Tour state is an enhancement; a blocked storage API must not block app use.
    } finally {
      setHydrated(true);
    }
  }, [autoOpenKey, manifest, storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(progress));
    } catch {
      // Ignore private-mode/storage-quota failures.
    }
  }, [hydrated, progress, storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    const matching = manifest.steps.filter(
      (step) => pathname === step.href || pathname.startsWith(`${step.href}/`),
    );
    if (matching.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress((current) => ({
      ...current,
      lastStepId: matching[matching.length - 1].id,
      completedStepIds: Array.from(new Set([
        ...current.completedStepIds,
        ...matching.map((step) => step.id),
      ])),
    }));
  }, [hydrated, manifest.steps, pathname]);

  useEffect(() => {
    if (!hydrated) return;
    const checkpoint = searchParams.get("checkpoint");
    if (!checkpoint) return;
    const checkpointStep: Record<string, string> = {
      "portfolio-health": "portfolio-health",
      "ai-evidence": "repaired-ai-trace",
      "role-switching": "portfolio-health",
      "dlq-recovery": "dead-letter-recovery",
    };
    const stepId = checkpointStep[checkpoint];
    if (!stepId || !manifest.steps.some((step) => step.id === stepId)) return;
    // The checkpoint is an external URL input; applying it after hydration is
    // the intentional synchronization point for Recruiter Mode.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress((current) => ({ ...current, lastStepId: stepId }));
    setOpen(true);
  }, [hydrated, manifest.steps, searchParams]);

  const completed = new Set([
    ...progress.completedStepIds,
    ...manifest.steps.filter((step) => step.complete).map((step) => step.id),
  ]);
  const activeIndex = Math.max(
    0,
    manifest.steps.findIndex((step) => step.id === progress.lastStepId),
  );
  const activeStep = manifest.steps[activeIndex] ?? manifest.steps[0];
  const completionPercent = manifest.steps.length
    ? Math.round((completed.size / manifest.steps.length) * 100)
    : 0;

  function restart() {
    const fresh: TourProgress = {
      version: manifest.version,
      completedStepIds: [],
      autoOpened: true,
    };
    setProgress(fresh);
    setOpen(true);
  }

  async function resetDemo() {
    if (!window.confirm("Reset this isolated demo? Your current walkthrough state and generated work will be replaced.")) return;
    setResetting(true);
    try {
      const response = await fetch("/api/demo/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      if (!response.ok) throw new Error("Reset failed");
      window.localStorage.removeItem(storageKey);
      router.push("/dashboard");
      router.refresh();
    } catch {
      window.alert("The demo could not be reset. Your current workspace is still available.");
    } finally {
      setResetting(false);
    }
  }

  async function switchRole(targetRole: Role) {
    if (targetRole === role || switchingRole) return;
    setSwitchingRole(targetRole);
    try {
      const response = await fetch("/api/demo/role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: targetRole, returnTo: pathname }),
      });
      const payload = (await response.json()) as { redirectTo?: string; error?: string };
      if (!response.ok || !payload.redirectTo) throw new Error(payload.error ?? "Role switch failed");
      router.replace(payload.redirectTo);
      router.refresh();
    } catch {
      window.alert("That demo persona could not be activated. Your current view is still available.");
    } finally {
      setSwitchingRole(null);
    }
  }

  return (
    <>
      {manifest.isDemo && manifest.demoPersonas && (
        <div className="sticky top-0 z-30 border-b border-cyan-200 bg-white/95 px-4 py-2 shadow-sm backdrop-blur" data-testid="demo-role-bar">
          <div className="mx-auto flex max-w-[calc(100vw-2rem)] items-center gap-3 overflow-x-auto lg:ml-60 lg:max-w-none lg:px-4">
            <div className="shrink-0 pr-2"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700">Demo personas</p><p className="text-xs text-slate-500">One-click RBAC view</p></div>
            <div className="flex min-w-0 gap-2" role="group" aria-label="Switch demo persona">
              {manifest.demoPersonas.map((persona) => (
                <button
                  key={persona.role}
                  type="button"
                  onClick={() => switchRole(persona.role)}
                  disabled={Boolean(switchingRole)}
                  aria-pressed={persona.role === role}
                  aria-busy={switchingRole === persona.role}
                  title={persona.focus}
                  data-testid={`demo-role-${persona.role}`}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-1 ${persona.role === role ? "border-cyan-400 bg-cyan-50 text-cyan-950" : "border-slate-200 bg-white text-slate-600 hover:border-cyan-300 hover:text-slate-950"}`}
                >
                  <span className="block text-xs font-semibold">{switchingRole === persona.role ? "Switching…" : persona.label}</span>
                  <span className="hidden text-[10px] text-slate-500 xl:block">{persona.role === role ? "Active persona" : persona.focus}</span>
                </button>
              ))}
            </div>
            <span className="ml-auto hidden shrink-0 text-[11px] text-slate-500 lg:block" aria-live="polite">{switchingRole ? "Refreshing permissions…" : "Synthetic isolated workspace"}</span>
          </div>
        </div>
      )}
      <div className={`min-h-screen transition-[margin] duration-300 motion-reduce:transition-none ${open ? "lg:mr-[23rem]" : ""}`}>
        {children}
      </div>

      {manifest.steps.length > 0 && (
        <>
          {open && <button aria-label="Close product tour overlay" className="fixed inset-0 z-40 bg-slate-950/30 lg:hidden" onClick={() => setOpen(false)} />}
          <aside
            aria-label={manifest.isDemo ? "Recruiter Mode" : "Product tour"}
            aria-hidden={!open}
            data-testid="recruiter-mode-panel"
            className={`fixed inset-y-0 right-0 z-50 flex w-[min(92vw,23rem)] flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 motion-reduce:transition-none ${open ? "translate-x-0" : "pointer-events-none translate-x-full"}`}
          >
            <div className="border-b border-slate-100 bg-[#081526] px-5 py-5 text-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">{manifest.isDemo ? "Recruiter Mode" : "Product tour"}</p>
                  <h2 className="mt-1 text-lg font-semibold">{manifest.isDemo ? "Tell the implementation story" : "See the workflow"}</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-300">{manifest.isDemo ? "A guided path through delivery, governance, AI proof, and operations." : "A role-aware checklist with one useful next action at each stop."}</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Minimize product tour">×</button>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between text-[11px] text-slate-300"><span>{completed.size} of {manifest.steps.length} steps</span><span>{completionPercent}%</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-300 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${completionPercent}%` }} /></div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <ol className="space-y-1">
                {manifest.steps.map((step, index) => {
                  const done = completed.has(step.id);
                  const current = index === activeIndex;
                  return (
                    <li key={step.id}>
                      <Link href={step.href} onClick={() => setOpen(false)} aria-current={current ? "step" : undefined} data-testid={`tour-step-${step.id}`} className={`flex gap-3 rounded-lg px-3 py-2.5 transition-colors ${current ? "bg-cyan-50 ring-1 ring-cyan-200" : "hover:bg-slate-50"}`}>
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-emerald-100 text-emerald-700" : current ? "bg-cyan-500 text-white" : "bg-slate-100 text-slate-500"}`}>{done ? "✓" : index + 1}</span>
                        <span className="min-w-0"><span className={`block text-sm font-medium ${current ? "text-slate-950" : "text-slate-700"}`}>{step.title}</span><span className="mt-0.5 block text-xs leading-4 text-slate-500">{step.evidence}</span></span>
                      </Link>
                    </li>
                  );
                })}
              </ol>

              {activeStep && (
                <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4" data-testid="tour-active-step">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Next best action</p>
                  <h3 className="mt-1 text-sm font-semibold text-slate-900">{activeStep.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{activeStep.purpose}</p>
                  <Link href={activeStep.href} onClick={() => setOpen(false)} className="btn-primary mt-3 w-full" data-testid="tour-primary-action">{activeStep.cta}<span aria-hidden>→</span></Link>
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 px-4 py-3">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={restart} data-testid="tour-restart" className="btn-secondary text-xs">Restart tour</button>
                {manifest.isDemo && <button type="button" onClick={resetDemo} disabled={resetting} data-testid="tour-reset" className="btn-secondary text-xs text-rose-700">{resetting ? "Resetting…" : "Reset demo"}</button>}
              </div>
            </div>
          </aside>

          {!open && (
            <button type="button" onClick={() => setOpen(true)} data-testid="tour-open" className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-lg transition hover:border-cyan-300 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-100 text-xs text-cyan-700">{completionPercent === 100 ? "✓" : "→"}</span>
              {manifest.isDemo ? "Recruiter Mode" : "Product tour"}
            </button>
          )}
        </>
      )}

      {demoQuota && (
        <div className={`fixed bottom-4 z-30 max-w-sm rounded-lg border border-cyan-200 bg-slate-950 px-4 py-3 text-xs text-white shadow-xl transition-[right] duration-300 motion-reduce:transition-none ${open ? "right-4 lg:right-[24rem]" : "right-4"}`}>
          <div className="flex items-start justify-between gap-4"><div><p className="font-semibold text-cyan-300">Isolated interactive demo</p><p className="mt-1 text-slate-300">Synthetic workspace · expires {new Date(demoQuota.expiresAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p></div><button type="button" onClick={resetDemo} disabled={resetting} className="text-[11px] font-semibold text-cyan-200 underline decoration-cyan-400/40 underline-offset-2 hover:text-white">{resetting ? "Resetting…" : "Reset"}</button></div>
          <p className="mt-1 text-slate-400">{demoQuota.generations.limit - demoQuota.generations.used} AI generations left · {demoQuota.uploads.limit - demoQuota.uploads.used} uploads left · {quotaBytes(demoQuota.storageBytes.used)} / {quotaBytes(demoQuota.storageBytes.limit)}</p>
        </div>
      )}
    </>
  );
}
