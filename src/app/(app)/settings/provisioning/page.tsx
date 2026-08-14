import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { SettingsNav } from "../SettingsNav";
import { ProvisioningPanel } from "./ProvisioningPanel";

export default async function ProvisioningPage() {
  const session = (await getSession())!;
  if (!can(session.role, "org.manage_identity")) redirect("/dashboard");
  return <div><PageHeader title="Provisioning" subtitle="Issue scoped SCIM credentials, revoke them, and keep directory lifecycle actions auditable." /><SettingsNav active="/settings/provisioning" /><ProvisioningPanel /></div>;
}
