import Link from "next/link";

const links = [
  ["/settings", "Settings overview"],
  ["/settings/members", "People & roles"],
  ["/settings/identity", "SSO"],
  ["/settings/provisioning", "Provisioning"],
  ["/settings/integrations", "Integrations"],
  ["/settings/data-lifecycle", "Data lifecycle"],
  ["/settings/api", "API contract"],
] as const;

export function SettingsNav({ active }: { active: string }) {
  return <nav aria-label="Settings" data-testid="settings-nav" className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-2 sm:flex-nowrap sm:overflow-x-auto">{links.map(([href, label]) => <Link key={href} href={href} aria-current={active === href ? "page" : undefined} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium ${active === href ? "bg-cyan-100 text-cyan-950" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}>{label}</Link>)}</nav>;
}
