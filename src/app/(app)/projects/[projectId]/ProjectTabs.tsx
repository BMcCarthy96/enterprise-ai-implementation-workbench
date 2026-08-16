"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

interface ProjectTab {
  href: string;
  label: string;
}

function activeTabFor(pathname: string, tabs: ProjectTab[]): ProjectTab {
  return tabs.find((tab) => pathname === tab.href) ?? tabs[0];
}

export function ProjectBreadcrumb({
  projectName,
  tabs,
}: {
  projectName: string;
  tabs: ProjectTab[];
}) {
  const pathname = usePathname();
  const active = activeTabFor(pathname, tabs);
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-slate-500" data-testid="project-breadcrumb">
      <Link href="/projects" className="font-semibold text-indigo-700 hover:text-indigo-900">
        All projects
      </Link>
      <span aria-hidden>/</span>
      <span className="max-w-56 truncate text-slate-700">{projectName}</span>
      <span aria-hidden>/</span>
      <span aria-current="page" className="font-medium text-slate-900">{active.label}</span>
    </nav>
  );
}

export function ProjectTabs({
  tabs,
}: {
  tabs: ProjectTab[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const active = activeTabFor(pathname, tabs);
  return (
    <nav aria-label="Project sections" className="min-w-0" data-testid="project-navigation">
      <label className="grid gap-1.5 xl:hidden">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Project section
        </span>
        <select
          value={active.href}
          onChange={(event) => router.push(event.target.value)}
          className="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-300"
          data-testid="project-section-select"
        >
          {tabs.map((tab) => <option key={tab.href} value={tab.href}>{tab.label}</option>)}
        </select>
      </label>
      <div className="-mb-px hidden min-w-0 flex-wrap gap-1 xl:flex" data-testid="project-tabs">
        {tabs.map((tab) => {
          const current = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                current
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
