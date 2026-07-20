/**
 * Role-based access control matrix.
 *
 * Four personas (see docs/architecture.md):
 * - org_admin: operations admin; full control including membership management.
 * - implementation_manager: owns delivery; approves plans and updates.
 * - solutions_engineer: does the build work; drafts but cannot approve.
 * - customer_stakeholder: external read-only view of status and published updates.
 */

export const ROLES = [
  "org_admin",
  "implementation_manager",
  "solutions_engineer",
  "customer_stakeholder",
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "org.manage_members",
  "customers.manage",
  "projects.manage",
  "requirements.manage",
  "plans.generate",
  "approvals.decide",
  "tasks.manage",
  "updates.draft",
  "documents.upload",
  "audit.view",
  "ops.view",
  "ops.retry_jobs",
  "internal.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, readonly Permission[]> = {
  org_admin: PERMISSIONS,
  implementation_manager: [
    "customers.manage",
    "projects.manage",
    "requirements.manage",
    "plans.generate",
    "approvals.decide",
    "tasks.manage",
    "updates.draft",
    "documents.upload",
    "audit.view",
    "ops.view",
    "ops.retry_jobs",
    "internal.view",
  ],
  solutions_engineer: [
    "requirements.manage",
    "plans.generate",
    "tasks.manage",
    "updates.draft",
    "documents.upload",
    "ops.view",
    "internal.view",
  ],
  customer_stakeholder: [],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return MATRIX[role];
}

/** Human-readable labels used across the UI. */
export const ROLE_LABELS: Record<Role, string> = {
  org_admin: "Operations Admin",
  implementation_manager: "Implementation Manager",
  solutions_engineer: "Solutions Engineer",
  customer_stakeholder: "Customer Stakeholder",
};
