"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoutButton } from "@/components/LogoutButton";
import { SearchPaletteTrigger } from "@/components/SearchPalette";
import type { NavItem } from "./layout";

export function MobileNav({ groups, orgName, userName }: { groups: Array<{ label: string; items: NavItem[] }>; orgName: string; userName: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);
  return (
    <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur lg:hidden" data-testid="mobile-nav">
      <div className="flex items-center justify-between gap-3">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2" onClick={() => setOpen(false)}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-300 text-[11px] font-black text-slate-950">EA</span>
          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-950">Enterprise AI</span><span className="block truncate text-[11px] text-slate-500">{orgName}</span></span>
        </Link>
        <button type="button" aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen((value) => !value)} className="min-h-11 min-w-11 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
          <span className="sr-only">{open ? "Close" : "Open"} navigation</span>{open ? "×" : "Menu"}
        </button>
      </div>
      {open && <nav id="mobile-navigation" aria-label="Mobile main navigation" className="mt-3 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
        {groups.map((group) => <div key={group.label} className="mb-3 last:mb-0"><p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{group.label}</p>{group.items.map((item) => { const active = pathname === item.href || pathname.startsWith(item.href + "/"); return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)} className={`block min-h-11 rounded-lg px-3 py-2.5 text-sm font-medium ${active ? "bg-cyan-100 text-cyan-950" : "text-slate-700 hover:bg-white"}`}>{item.label}</Link>; })}</div>)}
        <div className="mt-3 space-y-2 border-t border-slate-200 px-1 pt-3">
          <SearchPaletteTrigger variant="mobile" onOpen={() => setOpen(false)} />
          <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 text-xs text-slate-500">
            <span className="min-w-0">Signed in as <span className="font-medium text-slate-700">{userName}</span></span>
            <LogoutButton className="shrink-0 rounded-md px-2 py-2 font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60" />
          </div>
        </div>
      </nav>}
    </div>
  );
}
