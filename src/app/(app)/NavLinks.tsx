"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({
  groups,
}: {
  groups: Array<{ label: string; items: Array<{ href: string; label: string }> }>;
}) {
  const pathname = usePathname();
  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="mb-4 last:mb-0">
          <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            {group.label}
          </p>
          {group.items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-1.5 text-sm font-medium ${
                  active
                    ? "bg-cyan-300/10 text-cyan-200"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}
