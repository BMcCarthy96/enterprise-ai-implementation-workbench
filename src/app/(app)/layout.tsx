import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema, withTenantTransaction } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can, ROLE_LABELS, type Permission } from "@/lib/auth/rbac";
import { LogoutButton } from "@/components/LogoutButton";
import { SearchPalette } from "@/components/SearchPalette";
import { NavLinks } from "./NavLinks";

export interface NavItem {
  href: string;
  label: string;
  permission: Permission | null;
}

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Delivery",
    items: [
      { href: "/dashboard", label: "Dashboard", permission: null },
      { href: "/projects", label: "Projects", permission: null },
      { href: "/approvals", label: "Approvals", permission: "internal.view" },
    ],
  },
  {
    label: "AI quality",
    items: [
      { href: "/insights", label: "Insights", permission: "audit.view" },
      { href: "/ai-runs", label: "AI Runs", permission: "audit.view" },
    ],
  },
  {
    label: "Governance",
    items: [
      { href: "/audit", label: "Audit Log", permission: "audit.view" },
      { href: "/settings/members", label: "Members", permission: "org.manage_members" },
    ],
  },
  {
    label: "Operations",
    items: [{ href: "/ops", label: "Operations", permission: "ops.view" }],
  },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (n) => n.permission === null || can(session.role, n.permission),
    ),
  })).filter((group) => group.items.length > 0);
  const demoWorkspace = session.demoWorkspaceId
    ? await withTenantTransaction(
        session.orgId,
        () =>
          db.query.demoWorkspaces.findFirst({
            where: and(
              eq(schema.demoWorkspaces.id, session.demoWorkspaceId!),
              eq(schema.demoWorkspaces.orgId, session.orgId),
            ),
            columns: {
              generationJobsUsed: true,
              maxGenerationJobs: true,
              uploadCount: true,
              maxUploads: true,
              uploadBytes: true,
              maxStorageBytes: true,
            },
          }),
        session.userId,
      )
    : null;
  const formatBytes = (bytes: number) =>
    bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.round(bytes / 1024)} KB`;

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 flex w-60 flex-col border-r border-slate-800 bg-[#081526]">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-300 text-[11px] font-black text-slate-950">
            EA
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">
              Enterprise AI
            </p>
            <p className="truncate text-[11px] text-slate-400">Implementation Workbench</p>
            <p className="truncate text-[11px] text-slate-500">{session.orgName}</p>
          </div>
        </div>
        <div className="px-2 pt-3">
          <SearchPalette />
        </div>
        <nav aria-label="Main" className="flex-1 space-y-0.5 px-2 py-3">
          <NavLinks groups={groups} />
        </nav>
        <div className="border-t border-white/10 px-4 py-3">
          <p className="truncate text-sm font-medium text-white">
            {session.name}
          </p>
          <p className="mb-1 truncate text-xs text-gray-500">
            {ROLE_LABELS[session.role]}
          </p>
          <LogoutButton />
        </div>
      </aside>
      <main className="ml-60 flex-1 px-8 py-6">{children}</main>
      {session.demoWorkspaceId && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-cyan-200 bg-slate-950 px-4 py-3 text-xs text-white shadow-xl">
          <p className="font-semibold text-cyan-300">Isolated interactive demo</p>
          <p className="mt-1 text-slate-300">Synthetic workspace · expires {session.demoExpiresAt ? new Date(session.demoExpiresAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "soon"}</p>
          {demoWorkspace && (
            <p className="mt-1 text-slate-400">
              {demoWorkspace.maxGenerationJobs - demoWorkspace.generationJobsUsed} AI generations left · {demoWorkspace.maxUploads - demoWorkspace.uploadCount} uploads left · {formatBytes(demoWorkspace.uploadBytes)} / {formatBytes(demoWorkspace.maxStorageBytes)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
