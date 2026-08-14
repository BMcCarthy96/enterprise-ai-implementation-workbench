import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { SettingsNav } from "../SettingsNav";
import { ApiExplorer } from "./ApiExplorer";

export default async function ApiSettingsPage() {
  const session = (await getSession())!;
  if (!can(session.role, "org.manage_members")) redirect("/dashboard");
  return <div><PageHeader title="API contract" subtitle="A read-only view of the generated application contract and permission-aware route surface." /><SettingsNav active="/settings/api" /><ApiExplorer /></div>;
}
