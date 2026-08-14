import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { getSession } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/rbac";
import { SettingsNav } from "./SettingsNav";

const sections = [
  { href: "/settings/members", label: "People & roles", description: "Review memberships, capabilities, and organization access.", permission: "org.manage_members" as Permission },
  { href: "/settings/identity", label: "SSO", description: "Configure OIDC providers, domains, JIT provisioning, and group mappings.", permission: "org.manage_identity" as Permission },
  { href: "/settings/provisioning", label: "Provisioning", description: "Issue and revoke SCIM tokens and inspect directory mappings.", permission: "org.manage_identity" as Permission },
  { href: "/settings/integrations", label: "Integrations", description: "Register signed webhooks, test delivery, and inspect retry history.", permission: "org.manage_integrations" as Permission },
  { href: "/settings/data-lifecycle", label: "Data lifecycle", description: "Preview and tune retention windows with an auditable change trail.", permission: "org.manage_retention" as Permission },
  { href: "/settings/api", label: "API contract", description: "Browse the read-only OpenAPI surface generated from application contracts.", permission: "org.manage_members" as Permission },
];

export default async function SettingsPage() {
  const session = (await getSession())!;
  if (!can(session.role, "org.manage_members")) redirect("/dashboard");
  const visible = sections.filter((section) => can(session.role, section.permission));
  return <div><PageHeader title="Settings" subtitle={`Operable identity, integration, and data-lifecycle controls for ${session.orgName}.`} /><SettingsNav active="/settings" /><div className="grid gap-4 md:grid-cols-2">{visible.map((section) => <Link key={section.href} href={section.href} className="card group p-5 transition hover:border-cyan-300 hover:shadow-md"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Control surface</p><h2 className="mt-2 text-base font-semibold text-slate-950 group-hover:text-cyan-800">{section.label} <span aria-hidden>→</span></h2><p className="mt-2 text-sm leading-6 text-slate-600">{section.description}</p></Link>)}</div></div>;
}
