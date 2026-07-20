"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ProjectTabs({
  tabs,
}: {
  tabs: Array<{ href: string; label: string }>;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Project sections" className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              active
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
