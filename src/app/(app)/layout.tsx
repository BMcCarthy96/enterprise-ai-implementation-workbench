import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { can, ROLE_LABELS, type Permission } from "@/lib/auth/rbac";
import { LogoutButton } from "@/components/LogoutButton";
import { NavLinks } from "./NavLinks";

export interface NavItem {
  href: string;
  label: string;
  permission: Permission | null;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", permission: null },
  { href: "/projects", label: "Projects", permission: null },
  { href: "/approvals", label: "Approvals", permission: "internal.view" },
  { href: "/insights", label: "Insights", permission: "audit.view" },
  { href: "/audit", label: "Audit Log", permission: "audit.view" },
  { href: "/ops", label: "Operations", permission: "ops.view" },
  { href: "/settings/members", label: "Members", permission: "org.manage_members" },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const items = NAV.filter(
    (n) => n.permission === null || can(session.role, n.permission),
  );

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 flex w-56 flex-col border-r border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-sm font-bold text-white">
            W
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">
              Workbench
            </p>
            <p className="truncate text-xs text-gray-500">{session.orgName}</p>
          </div>
        </div>
        <nav aria-label="Main" className="flex-1 space-y-0.5 px-2 py-3">
          <NavLinks items={items} />
        </nav>
        <div className="border-t border-gray-100 px-4 py-3">
          <p className="truncate text-sm font-medium text-gray-800">
            {session.name}
          </p>
          <p className="mb-1 truncate text-xs text-gray-500">
            {ROLE_LABELS[session.role]}
          </p>
          <LogoutButton />
        </div>
      </aside>
      <main className="ml-56 flex-1 px-8 py-6">{children}</main>
    </div>
  );
}
