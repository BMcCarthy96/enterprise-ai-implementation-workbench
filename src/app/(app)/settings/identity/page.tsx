import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { SettingsNav } from "../SettingsNav";
import { IdentityForm } from "./IdentityForm";

export default async function IdentitySettingsPage() {
  const session = (await getSession())!;
  if (!can(session.role, "org.manage_identity")) redirect("/dashboard");
  return <div><PageHeader title="SSO" subtitle="Configure OIDC login, JIT provisioning, and group-to-role mappings without exposing secrets." /><SettingsNav active="/settings/identity" /><IdentityForm /></div>;
}
