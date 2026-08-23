"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  checkpointTourStepId,
  completeTourStep,
  reconcileTourStepId,
  restartTourProgress,
  sameTourPath,
  type TourManifest,
  type TourProgress,
} from "@/lib/tour";
import type { Role } from "@/lib/auth/rbac";
import { DemoPersonaSwitcher } from "./DemoPersonaSwitcher";
import { RecruiterCoachmark } from "./RecruiterCoachmark";

type TourMode = "closed" | "checklist" | "coachmark";

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
  const [mode, setMode] = useState<TourMode>("closed");
  const [resetting, setResetting] = useState(false);
  const [switchingRole, setSwitchingRole] = useState<Role | null>(null);
  const [rolePromptOpen, setRolePromptOpen] = useState(false);
  const [resetPrompt, setResetPrompt] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const resetDialogRef = useRef<HTMLDialogElement>(null);
  const resetReturnFocusRef = useRef<HTMLElement | null>(null);
  const tourOpenRef = useRef<HTMLButtonElement>(null);
  const checklistCloseRef = useRef<HTMLButtonElement>(null);
  const restoreTourFocusRef = useRef(false);
  const previousRoleRef = useRef(role);
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
        setMode("coachmark");
        setProgress((current) => ({
          ...current,
          autoOpened: true,
          lastStepId: current.lastStepId ?? manifest.steps[0]?.id,
        }));
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
    const matching = manifest.steps.find((step) => sameTourPath(pathname, step.href));
    if (!matching) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress((current) => ({
      ...current,
      lastStepId: matching.id,
    }));
  }, [hydrated, manifest.steps, pathname]);

  useEffect(() => {
    if (previousRoleRef.current === role) return;
    previousRoleRef.current = role;
    const nextStepId = reconcileTourStepId(manifest.steps, pathname);
    const nextStep = manifest.steps.find((candidate) => candidate.id === nextStepId);
    // A persona switch keeps a route-matching step when one exists and starts
    // from the new persona's first permitted destination otherwise.
    setProgress((current) => ({ ...current, lastStepId: nextStepId }));
    if (mode === "coachmark" && nextStep && !sameTourPath(pathname, nextStep.href)) {
      router.replace(nextStep.href);
    }
    setMode("closed");
    setRolePromptOpen(manifest.isDemo);
  }, [manifest.isDemo, manifest.steps, mode, pathname, role, router]);

  useEffect(() => {
    if (mode === "closed") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      restoreTourFocusRef.current = true;
      setMode("closed");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode]);

  useEffect(() => {
    if (mode !== "closed" || !restoreTourFocusRef.current) return;
    restoreTourFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => tourOpenRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  useEffect(() => {
    if (mode !== "checklist") return;
    const frame = window.requestAnimationFrame(() => checklistCloseRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  useEffect(() => {
    const dialog = resetDialogRef.current;
    if (!dialog) return;
    if (resetPrompt && !dialog.open) {
      dialog.showModal();
      return;
    }
    if (!resetPrompt && dialog.open) {
      dialog.close();
      resetReturnFocusRef.current?.focus();
      resetReturnFocusRef.current = null;
    }
  }, [resetPrompt]);

  useEffect(() => {
    if (!hydrated) return;
    const checkpoint = searchParams.get("checkpoint");
    if (!checkpoint) return;
    const stepId = checkpointTourStepId(checkpoint);
    if (!stepId || !manifest.steps.some((step) => step.id === stepId)) return;
    const checkpointStep = manifest.steps.find((step) => step.id === stepId);
    // The checkpoint is an external URL input; applying it after hydration is
    // the intentional synchronization point for the guided walkthrough.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress((current) => ({ ...current, lastStepId: stepId }));
    setMode(manifest.isDemo ? "coachmark" : "checklist");
    if (manifest.isDemo && checkpointStep && !sameTourPath(pathname, checkpointStep.href)) {
      router.push(checkpointStep.href);
    }
  }, [hydrated, manifest.isDemo, manifest.steps, pathname, router, searchParams]);

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
  const checklistOpen = mode === "checklist";
  const coachmarkOpen = mode === "coachmark" && manifest.isDemo && Boolean(activeStep);
  const activeRouteReady = Boolean(activeStep && sameTourPath(pathname, activeStep.href));

  function restart() {
    const firstStep = manifest.steps[0];
    const fresh = restartTourProgress(manifest.version, manifest.steps);
    setProgress(fresh);
    setMode(manifest.isDemo ? "coachmark" : "checklist");
    if (firstStep && !sameTourPath(pathname, firstStep.href)) {
      router.push(firstStep.href);
    }
  }

  function activateStep(index: number, completeCurrent = false) {
    const nextStep = manifest.steps[index];
    if (!nextStep) return;
    setProgress((current) => ({
      ...(completeCurrent && activeStep
        ? completeTourStep(current, activeStep.id)
        : current),
      lastStepId: nextStep.id,
    }));
    setMode(manifest.isDemo ? "coachmark" : "closed");
    if (!sameTourPath(pathname, nextStep.href)) router.push(nextStep.href);
  }

  function advanceTour() {
    if (!activeStep) return;
    if (activeIndex === manifest.steps.length - 1) {
      setProgress((current) => completeTourStep(current, activeStep.id));
      restoreTourFocusRef.current = true;
      setMode("closed");
      return;
    }
    activateStep(activeIndex + 1, true);
  }

  function returnToActiveDestination() {
    if (!activeStep) return;
    if (sameTourPath(pathname, activeStep.href)) {
      router.refresh();
      return;
    }
    router.push(activeStep.href);
  }

  async function performReset() {
    setResetPrompt(false);
    setResetting(true);
    try {
      const response = await fetch("/api/demo/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      if (!response.ok) throw new Error("Reset failed");
      window.localStorage.removeItem(storageKey);
      setMode("closed");
      router.push("/dashboard");
      router.refresh();
    } catch {
      setErrorMessage("The demo could not be reset. Your current workspace is still available.");
    } finally {
      setResetting(false);
    }
  }

  function resetDemo() {
    resetReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setResetPrompt(true);
  }

  function minimizeTour() {
    restoreTourFocusRef.current = true;
    setMode("closed");
  }

  function openTour() {
    setMode(manifest.isDemo ? "coachmark" : "checklist");
    if (manifest.isDemo && activeStep && !sameTourPath(pathname, activeStep.href)) {
      router.push(activeStep.href);
    }
  }

  function startRoleWalkthrough() {
    setRolePromptOpen(false);
    restart();
  }

  async function switchRole(targetRole: Role) {
    if (targetRole === role || switchingRole) return;
    setRolePromptOpen(false);
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
      setErrorMessage("That demo persona could not be activated. Your current view is still available.");
    } finally {
      setSwitchingRole(null);
    }
  }

  return (
    <>
      {manifest.isDemo && manifest.demoPersonas && (
        <DemoPersonaSwitcher
          personas={manifest.demoPersonas}
          role={role}
          switchingRole={switchingRole}
          onSwitch={(nextRole) => void switchRole(nextRole)}
        />
      )}
      <div className="min-h-screen">
        {children}
      </div>

      {rolePromptOpen && manifest.isDemo && (
        <div
          data-testid="role-tour-prompt"
          role="status"
          aria-live="polite"
          className="fixed left-4 right-4 top-20 z-[70] max-w-sm rounded-2xl border border-cyan-200 bg-white p-4 text-slate-900 shadow-xl sm:left-auto sm:right-4"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-700">
            {manifest.demoPersonas?.find((persona) => persona.role === role)?.label ?? "Demo view"}
          </p>
          <h2 className="mt-1 text-base font-semibold">Start this walkthrough?</h2>
          <p className="mt-1 text-sm leading-5 text-slate-600">
            This view has a short path through {manifest.steps[0]?.title.toLowerCase() ?? "the project"} and the parts that matter for this role.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" data-testid="role-tour-start" onClick={startRoleWalkthrough}>
              Start this walkthrough
            </button>
            <button type="button" className="btn-secondary" data-testid="role-tour-dismiss" onClick={() => setRolePromptOpen(false)}>
              Maybe later
            </button>
          </div>
        </div>
      )}

      {manifest.steps.length > 0 && (
        <>
          {checklistOpen && <button aria-label={manifest.isDemo ? "Close guided walkthrough overlay" : "Close product tour overlay"} className="fixed inset-0 z-40 bg-slate-950/30" onClick={minimizeTour} />}
          <aside
            aria-label={manifest.isDemo ? "Guided walkthrough" : "Product tour"}
            aria-hidden={!checklistOpen}
            inert={!checklistOpen ? true : undefined}
            data-testid="recruiter-mode-panel"
            className={`fixed inset-y-0 right-0 z-50 flex w-[min(92vw,23rem)] flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 motion-reduce:transition-none ${checklistOpen ? "translate-x-0" : "pointer-events-none translate-x-full"}`}
          >
            <div className="border-b border-slate-100 bg-[#081526] px-5 py-5 text-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">{manifest.isDemo ? "Guided walkthrough" : "Product tour"}</p>
                  <h2 className="mt-1 text-lg font-semibold">{manifest.isDemo ? "See how the project works" : "See how the app works"}</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-300">{manifest.isDemo ? "Each step opens part of the project and points to something worth checking." : "Pick a step to open that part of the app."}</p>
                </div>
                <button ref={checklistCloseRef} type="button" onClick={minimizeTour} className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white" aria-label={manifest.isDemo ? "Minimize guided walkthrough" : "Minimize product tour"}>×</button>
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
                      <button type="button" onClick={() => activateStep(index)} aria-current={current ? "step" : undefined} data-testid={`tour-step-${step.id}`} className={`flex w-full gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${current ? "bg-cyan-50 ring-1 ring-cyan-200" : "hover:bg-slate-50"}`}>
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-emerald-100 text-emerald-700" : current ? "bg-cyan-500 text-white" : "bg-slate-100 text-slate-500"}`}>{done ? "✓" : index + 1}</span>
                        <span className="min-w-0"><span className={`block text-sm font-medium ${current ? "text-slate-950" : "text-slate-700"}`}>{step.title}</span><span className="mt-0.5 block text-xs leading-4 text-slate-500">{step.evidence}</span></span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              {activeStep && (
                <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4" data-testid="tour-active-step">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Current step</p>
                  <h3 className="mt-1 text-sm font-semibold text-slate-900">{activeStep.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{activeStep.purpose}</p>
                  <button type="button" onClick={() => activateStep(activeIndex)} className="btn-primary mt-3 w-full" data-testid="tour-primary-action">Show this step<span aria-hidden>→</span></button>
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
        </>
      )}

      {coachmarkOpen && activeStep && (
        <RecruiterCoachmark
          key={`${manifest.role}:${activeStep.id}`}
          step={activeStep}
          stepIndex={activeIndex}
          totalSteps={manifest.steps.length}
          routeReady={activeRouteReady}
          onBack={() => activateStep(Math.max(0, activeIndex - 1))}
          onNext={advanceTour}
          onShowSteps={() => setMode("checklist")}
          onClose={minimizeTour}
          onReturnToDestination={returnToActiveDestination}
        />
      )}

      {mode === "closed" && (manifest.steps.length > 0 || demoQuota) && (
        <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-40 flex flex-col items-end gap-3 sm:left-auto sm:right-4">
          {manifest.steps.length > 0 && (
            <button ref={tourOpenRef} type="button" onClick={openTour} data-testid="tour-open" className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-lg transition hover:border-cyan-300 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-100 text-xs text-cyan-700">{completionPercent === 100 ? "✓" : "→"}</span>
              {manifest.isDemo ? `Guided walkthrough · ${activeIndex + 1}/${manifest.steps.length}` : "Product tour"}
            </button>
          )}
          {demoQuota && (
            <details data-testid="demo-quota" className="group pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg border border-cyan-200 bg-slate-950 text-xs text-white shadow-xl">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-4 py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300">
                <span>
                  <span className="block font-semibold text-cyan-300">Isolated demo</span>
                  <span className="mt-0.5 block text-slate-300">{demoQuota.generations.limit - demoQuota.generations.used} AI generations · {demoQuota.uploads.limit - demoQuota.uploads.used} uploads left</span>
                </span>
                <span className="shrink-0 font-semibold text-cyan-200 group-open:hidden">Details</span>
                <span className="hidden shrink-0 font-semibold text-cyan-200 group-open:inline">Hide</span>
              </summary>
              <div className="border-t border-white/10 px-4 py-3">
                <p className="text-slate-300">Synthetic workspace · expires {new Date(demoQuota.expiresAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p>
                <div className="mt-1 flex items-center justify-between gap-4 text-slate-400">
                  <span>{quotaBytes(demoQuota.storageBytes.used)} / {quotaBytes(demoQuota.storageBytes.limit)} storage</span>
                  <button type="button" onClick={resetDemo} disabled={resetting} className="font-semibold text-cyan-200 underline decoration-cyan-400/40 underline-offset-2 hover:text-white">{resetting ? "Resetting…" : "Reset demo"}</button>
                </div>
              </div>
            </details>
          )}
        </div>
      )}

      <dialog
        ref={resetDialogRef}
        aria-labelledby="reset-demo-title"
        className="m-auto w-[calc(100vw_-_2rem)] max-w-md rounded-2xl bg-white p-5 text-left shadow-2xl backdrop:bg-slate-950/45"
        onCancel={(event) => {
          event.preventDefault();
          setResetPrompt(false);
        }}
      >
          <h2 id="reset-demo-title" className="text-base font-semibold text-slate-950">Reset isolated demo?</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Your current walkthrough state and generated work will be replaced with the seeded scenario.</p>
          <div className="mt-5 flex justify-end gap-2"><button type="button" autoFocus className="btn-secondary" onClick={() => setResetPrompt(false)}>Keep workspace</button><button type="button" className="btn-primary bg-rose-600 hover:bg-rose-700" onClick={() => void performReset()}>Reset demo</button></div>
      </dialog>

      {errorMessage && <div className="fixed left-4 right-4 top-20 z-[80] max-w-sm rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm text-rose-800 shadow-xl sm:right-auto" role="alert"><div className="flex items-start gap-3"><span>{errorMessage}</span><button type="button" aria-label="Dismiss notification" className="min-h-8 min-w-8 rounded-md text-lg leading-none hover:bg-rose-50" onClick={() => setErrorMessage(null)}>×</button></div></div>}
    </>
  );
}
