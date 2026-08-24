"use client";

import { useState } from "react";

export function CopyValueButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-cyan-300 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
      onClick={() => void copy()}
      aria-label={`${label} value`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
