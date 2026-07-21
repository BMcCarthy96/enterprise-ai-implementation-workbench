"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchResult, SearchResultType } from "@/server/services/search";

/**
 * Global ⌘K / Ctrl-K command palette. Renders an in-sidebar trigger button plus
 * a fixed overlay modal that live-searches projects, requirements, and customers
 * (results are gated server-side by role). Keyboard: ⌘K/Ctrl+K to open, arrows
 * to move, Enter to open the highlighted result, Esc to close.
 */

const GROUP_ORDER: SearchResultType[] = ["project", "requirement", "customer"];
const GROUP_LABEL: Record<SearchResultType, string> = {
  project: "Projects",
  requirement: "Requirements",
  customer: "Customers",
};
const TYPE_BADGE: Record<SearchResultType, { letter: string; className: string }> = {
  project: { letter: "P", className: "bg-indigo-100 text-indigo-700" },
  requirement: { letter: "R", className: "bg-amber-100 text-amber-700" },
  customer: { letter: "C", className: "bg-emerald-100 text-emerald-700" },
};

const MIN_CHARS = 2;

/** ⌘ on Apple platforms, Ctrl elsewhere. SSR renders the Ctrl form; the client
 *  reconciles (suppressed) so there is no hydration warning. */
function shortcutHint(): string {
  if (typeof navigator === "undefined") return "Ctrl K";
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘K" : "Ctrl K";
}

export function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setSearched(false);
    setActive(0);
  }, []);

  // Global shortcut: ⌘K / Ctrl+K toggles the palette from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus the input and lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Debounced search; aborts in-flight requests so results never arrive stale.
  // All state updates happen inside the deferred timer/promise callbacks (never
  // synchronously in the effect body) to avoid cascading renders.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const controller = new AbortController();
    const handle = setTimeout(() => {
      if (q.length < MIN_CHARS) {
        setResults([]);
        setSearched(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      fetch(`/api/v1/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.json() as Promise<{ results: SearchResult[] }>;
        })
        .then((data) => {
          setResults(data.results);
          setActive(0);
          setSearched(true);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") {
            setResults([]);
            setSearched(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 150);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [query, open]);

  const go = useCallback(
    (result: SearchResult | undefined) => {
      if (!result) return;
      close();
      router.push(result.href);
    },
    [close, router],
  );

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  const grouped = GROUP_ORDER.map((type) => ({
    type,
    items: results.filter((r) => r.type === type),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-500 transition-colors hover:border-gray-300 hover:bg-white"
        aria-label="Open search"
      >
        <SearchIcon />
        <span className="flex-1 text-left">Search…</span>
        <kbd
          suppressHydrationWarning
          className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-500"
        >
          {shortcutHint()}
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-gray-900/30 px-4 pt-[12vh]"
          onMouseDown={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
            className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/5"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-gray-100 px-4">
              <SearchIcon />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search projects, requirements, customers…"
                aria-label="Search query"
                className="w-full bg-transparent py-3.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
              />
              <kbd className="hidden rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-400 sm:block">
                Esc
              </kbd>
            </div>

            <div className="max-h-80 overflow-y-auto py-2">
              {query.trim().length < MIN_CHARS ? (
                <p className="px-4 py-6 text-center text-sm text-gray-400">
                  Type at least {MIN_CHARS} characters to search.
                </p>
              ) : loading && results.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-gray-400">
                  Searching…
                </p>
              ) : grouped.length === 0 && searched ? (
                <p className="px-4 py-6 text-center text-sm text-gray-400">
                  No matches for “{query.trim()}”.
                </p>
              ) : (
                grouped.map((group) => (
                  <div key={group.type} className="mb-1">
                    <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      {GROUP_LABEL[group.type]}
                    </p>
                    {group.items.map((item) => {
                      const idx = results.indexOf(item);
                      const badge = TYPE_BADGE[item.type];
                      return (
                        <button
                          key={`${item.type}:${item.id}`}
                          type="button"
                          onMouseEnter={() => setActive(idx)}
                          onClick={() => go(item)}
                          className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                            idx === active ? "bg-indigo-50" : "hover:bg-gray-50"
                          }`}
                        >
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold ${badge.className}`}
                          >
                            {badge.letter}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-gray-900">
                              {item.title}
                            </span>
                            {item.subtitle && (
                              <span className="block truncate text-xs text-gray-500">
                                {item.subtitle}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SearchIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-gray-400"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="6" />
      <path d="m17 17-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}
