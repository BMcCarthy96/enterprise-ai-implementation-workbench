import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema, withTenantTransaction } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can, ROLE_LABELS, type Permission } from "@/lib/auth/rbac";
import { LogoutButton } from "@/components/LogoutButton";
import { SearchPalette } from "@/components/SearchPalette";
import { NavLinks } from "./NavLinks";
import { AppShell } from "./AppShell";
import { MobileNav } from "./MobileNav";
import { getTourManifest } from "@/server/services/tour";

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
      { href: "/ai-runs", label: "AI Evidence", permission: "audit.view" },
    ],
  },
  {
    label: "Governance",
    items: [
      { href: "/audit", label: "Audit Log", permission: "audit.view" },
      { href: "/settings", label: "Settings", permission: "org.manage_members" },
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
  const { demoWorkspace, tourManifest } = await withTenantTransaction(
    session.orgId,
    async () => ({
      demoWorkspace: session.demoWorkspaceId
        ? await db.query.demoWorkspaces.findFirst({
            where: and(
              eq(schema.demoWorkspaces.id, session.demoWorkspaceId!),
              eq(schema.demoWorkspaces.orgId, session.orgId),
            ),
            columns: {
              expiresAt: true,
              generationJobsUsed: true,
              maxGenerationJobs: true,
              uploadCount: true,
              maxUploads: true,
              uploadBytes: true,
              maxStorageBytes: true,
              scenarioRefs: true,
            },
          })
        : null,
      tourManifest: await getTourManifest(session),
    }),
    session.userId,
  );

  return (
    <AppShell
      manifest={tourManifest}
      userId={session.userId}
      role={session.role}
      demoQuota={demoWorkspace ? {
        expiresAt: demoWorkspace.expiresAt.toISOString(),
        generations: { used: demoWorkspace.generationJobsUsed, limit: demoWorkspace.maxGenerationJobs },
        uploads: { used: demoWorkspace.uploadCount, limit: demoWorkspace.maxUploads },
        storageBytes: { used: demoWorkspace.uploadBytes, limit: demoWorkspace.maxStorageBytes },
      } : null}
    >
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[90] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-slate-950 focus:shadow-lg">Skip to main content</a>
    <div className="min-h-screen">
      <MobileNav groups={groups} orgName={session.orgName} userName={session.name} />
      <div className="flex min-h-[calc(100vh-57px)] lg:min-h-screen">
      <aside className="fixed inset-y-0 z-20 hidden w-60 flex-col border-r border-slate-800 bg-[#081526] lg:flex">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-300 text-[11px] font-black text-slate-950">
            EA
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
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
      <main id="main-content" className="ml-0 min-w-0 flex-1 px-4 py-5 sm:px-6 lg:ml-60 lg:px-8 lg:py-6">{children}</main>
      </div>
    </div>
    </AppShell>
  );
}
