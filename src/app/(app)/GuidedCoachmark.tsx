"use client";

import {
  FloatingArrow,
  FloatingFocusManager,
  FloatingPortal,
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TourStep } from "@/lib/tour";

const COACHMARK_DESCRIPTION_ID = "guided-coachmark-description";

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
}

function findTarget(step: TourStep): HTMLElement | null {
  for (const id of [step.target.id, step.target.fallbackId]) {
    if (!id) continue;
    const element = document.querySelector<HTMLElement>(
      `[data-tour-target="${CSS.escape(id)}"]`,
    );
    if (element && isVisible(element)) return element;
  }
  return null;
}

export function GuidedCoachmark({
  step,
  stepIndex,
  totalSteps,
  routeReady,
  onBack,
  onNext,
  onShowSteps,
  onClose,
  onReturnToDestination,
}: {
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  routeReady: boolean;
  onBack: () => void;
  onNext: () => void;
  onShowSteps: () => void;
  onClose: () => void;
  onReturnToDestination: () => void;
}) {
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [arrowElement, setArrowElement] = useState<SVGSVGElement | null>(null);
  const coachmarkRef = useRef<HTMLDivElement | null>(null);
  const titleId = `guided-coachmark-${step.id}`;

  const { refs, floatingStyles, context } = useFloating({
    open: true,
    elements: { reference: targetElement },
    placement: step.target.placement ?? "bottom",
    strategy: "fixed",
    middleware: [
      offset(14),
      flip({ padding: 12, fallbackAxisSideDirection: "end" }),
      shift({ padding: 12, crossAxis: true }),
      arrow({ element: arrowElement, padding: 10 }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const setFloating = useCallback(
    (node: HTMLDivElement | null) => {
      coachmarkRef.current = node;
      refs.setFloating(node);
    },
    [refs],
  );

  useEffect(() => {
    let resolved = false;
    let frame = 0;
    let observer: MutationObserver | null = null;
    const timer = window.setTimeout(() => {
      if (!resolved) setUnavailable(true);
    }, 5_000);

    if (!routeReady) {
      return () => window.clearTimeout(timer);
    }

    function resolveTarget() {
      if (resolved) return;
      const candidate = findTarget(step);
      if (!candidate) return;
      resolved = true;
      observer?.disconnect();
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      candidate.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: reduceMotion ? "auto" : "smooth",
      });
      frame = window.requestAnimationFrame(() => {
        setTargetElement(candidate);
        setTargetRect(candidate.getBoundingClientRect());
      });
    }

    resolveTarget();
    observer = new MutationObserver(resolveTarget);
    if (!resolved) {
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    }
    return () => {
      observer?.disconnect();
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [routeReady, step]);

  useEffect(() => {
    if (!targetElement) return;
    const previousDescription = targetElement.getAttribute("aria-describedby");
    targetElement.setAttribute(
      "aria-describedby",
      [previousDescription, COACHMARK_DESCRIPTION_ID].filter(Boolean).join(" "),
    );
    targetElement.setAttribute("data-tour-active", "true");

    const updateRect = () => setTargetRect(targetElement.getBoundingClientRect());
    const observer = new ResizeObserver(updateRect);
    observer.observe(targetElement);
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
      targetElement.removeAttribute("data-tour-active");
      if (previousDescription) {
        targetElement.setAttribute("aria-describedby", previousDescription);
      } else {
        targetElement.removeAttribute("aria-describedby");
      }
    };
  }, [targetElement]);

  const card = (
    <div className="relative">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700">
            Step {stepIndex + 1} of {totalSteps}
          </p>
          <h2 id={titleId} className="mt-1 text-base font-semibold text-slate-950">
            {step.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-9 min-w-9 rounded-lg text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400"
          aria-label="Exit guided walkthrough"
        >
          ×
        </button>
      </div>
      <div id={COACHMARK_DESCRIPTION_ID} className="mt-3 space-y-2">
        <p className="text-sm leading-5 text-slate-700">{step.purpose}</p>
        <p className="rounded-lg bg-cyan-50 px-3 py-2 text-xs leading-5 text-cyan-950">
          <span className="font-semibold">Look here:</span> {step.evidence}
        </p>
        <p className="text-xs leading-5 text-slate-500">
          Use Next step when you&apos;re ready.
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={stepIndex === 0}
          className="btn-secondary min-h-10 text-xs disabled:cursor-not-allowed disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="btn-primary min-h-10 text-xs"
          data-testid="tour-coachmark-next"
        >
          {stepIndex === totalSteps - 1 ? "Finish tour" : "Next step"}
          <span aria-hidden>→</span>
        </button>
        <button
          type="button"
          onClick={onShowSteps}
          className="ml-auto min-h-10 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-cyan-400"
        >
          All steps
        </button>
      </div>
    </div>
  );

  if (!targetElement) {
    return (
      <FloatingPortal>
        <div
          className="fixed inset-x-3 bottom-4 z-[70] mx-auto w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl border border-cyan-200 bg-white p-4 shadow-2xl sm:bottom-6"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          data-testid="tour-coachmark"
        >
          {unavailable ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                    Step {stepIndex + 1} of {totalSteps}
                  </p>
                  <h2 id={titleId} className="mt-1 text-base font-semibold text-slate-950">
                    This item is no longer here
                  </h2>
                </div>
                <button type="button" onClick={onClose} className="min-h-9 min-w-9 rounded-lg text-lg text-slate-500 hover:bg-slate-100" aria-label="Exit guided walkthrough">×</button>
              </div>
              <p className="mt-2 text-sm leading-5 text-slate-600">
                The demo changed after the tour opened. Return to this step&apos;s page to look again.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={onReturnToDestination} className="btn-secondary text-xs">Return to destination</button>
                <button type="button" onClick={onNext} className="btn-primary text-xs">Continue<span aria-hidden>→</span></button>
                <button type="button" onClick={onShowSteps} className="ml-auto min-h-10 px-2 text-xs font-semibold text-slate-600">All steps</button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3" role="status">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent motion-reduce:animate-none" aria-hidden />
              <div>
                <p id={titleId} className="text-sm font-semibold text-slate-900">Locating {step.title.toLowerCase()}…</p>
                <p className="mt-0.5 text-xs text-slate-500">Opening the page for this step.</p>
              </div>
            </div>
          )}
        </div>
      </FloatingPortal>
    );
  }

  return (
    <FloatingPortal>
      {targetRect && (
        <div
          aria-hidden
          data-testid="tour-spotlight"
          className="pointer-events-none fixed z-[60] rounded-xl ring-2 ring-cyan-300 ring-offset-2 ring-offset-white transition-[left,top,width,height] duration-200 motion-reduce:transition-none"
          style={{
            left: Math.max(4, targetRect.left - 6),
            top: Math.max(4, targetRect.top - 6),
            width: Math.max(12, targetRect.width + 12),
            height: Math.max(12, targetRect.height + 12),
            boxShadow: "0 0 0 9999px rgb(8 21 38 / 0.42)",
          }}
        />
      )}
      <FloatingFocusManager
        context={context}
        modal={false}
        initialFocus={coachmarkRef}
        returnFocus={false}
      >
        <div
          ref={setFloating}
          style={floatingStyles}
          className="z-[70] w-[min(22rem,calc(100vw-1.5rem))] outline-none"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-testid="tour-coachmark"
          >
          <FloatingArrow
            ref={setArrowElement}
            context={context}
            width={20}
            height={10}
            tipRadius={2}
            fill="white"
            stroke="#67e8f9"
            strokeWidth={1}
            data-testid="tour-coachmark-arrow"
          />
          <div className="max-h-[calc(100vh-1.5rem)] overflow-y-auto rounded-2xl border border-cyan-200 bg-white p-4 shadow-2xl">
            {card}
          </div>
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
