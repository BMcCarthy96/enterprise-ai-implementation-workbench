import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { SettingsNav } from "../SettingsNav";
import { RetentionPanel } from "./RetentionPanel";

export default async function DataLifecyclePage() {
  const session = (await getSession())!;
  if (!can(session.role, "org.manage_retention")) redirect("/dashboard");
  return <div><PageHeader title="Data lifecycle" subtitle="Preview retention impact, save bounded windows, and keep the last run visible." /><SettingsNav active="/settings/data-lifecycle" /><RetentionPanel /></div>;
}
