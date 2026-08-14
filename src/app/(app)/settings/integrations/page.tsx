import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { SettingsNav } from "../SettingsNav";
import { IntegrationsPanel } from "./IntegrationsPanel";

export default async function IntegrationsPage() {
  const session = (await getSession())!;
  if (!can(session.role, "org.manage_integrations")) redirect("/dashboard");
  return <div><PageHeader title="Integrations" subtitle="Signed, retryable outbound events with visible delivery history." /><SettingsNav active="/settings/integrations" /><IntegrationsPanel /></div>;
}
