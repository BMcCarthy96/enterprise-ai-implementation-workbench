import { and, eq, ilike, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { can, type Role } from "@/lib/auth/rbac";

/**
 * Global search across the tenant's delivery data — the data behind the ⌘K
 * command palette. Every query is scoped to the caller's org, and the set of
 * entity types a caller can search is gated by role (see searchableTypesFor):
 * projects are visible to everyone (like the Projects nav item), while
 * customers and requirements are internal-only, so a customer stakeholder can
 * never enumerate them.
 */

export type SearchResultType = "project" | "requirement" | "customer";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export const MIN_QUERY_LENGTH = 2;
const DEFAULT_PER_TYPE = 5;

/**
 * Which entity types a role may see in global search. Projects mirror the
 * always-visible Projects page; customers and requirements are internal.view
 * only. Pure and security-relevant, so it is unit-tested directly.
 */
export function searchableTypesFor(role: Role): SearchResultType[] {
  return can(role, "internal.view")
    ? ["project", "requirement", "customer"]
    : ["project"];
}

/**
 * Escape LIKE/ILIKE wildcards so user input is matched literally — otherwise a
 * query of "%" would match every row and "_" any single character.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function humanizeStatus(status: string): string {
  return status.replace(/_/g, " ");
}

export async function searchWorkbench(opts: {
  orgId: string;
  role: Role;
  query: string;
  perType?: number;
}): Promise<SearchResult[]> {
  const q = opts.query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const types = new Set(searchableTypesFor(opts.role));
  const like = `%${escapeLike(q)}%`;
  const perType = opts.perType ?? DEFAULT_PER_TYPE;
  const results: SearchResult[] = [];

  if (types.has("project")) {
    // Match on the project name/description and on the customer name, so typing
    // a customer ("Brightlane") surfaces their projects with a precise target.
    const rows = await db
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        status: schema.projects.status,
        customerName: schema.customers.name,
      })
      .from(schema.projects)
      .innerJoin(
        schema.customers,
        eq(schema.projects.customerId, schema.customers.id),
      )
      .where(
        and(
          eq(schema.projects.orgId, opts.orgId),
          or(
            ilike(schema.projects.name, like),
            ilike(schema.projects.description, like),
            ilike(schema.customers.name, like),
          ),
        ),
      )
      .limit(perType);
    for (const r of rows) {
      results.push({
        type: "project",
        id: r.id,
        title: r.name,
        subtitle: `${r.customerName} · ${humanizeStatus(r.status)}`,
        href: `/projects/${r.id}`,
      });
    }
  }

  if (types.has("requirement")) {
    const rows = await db
      .select({
        id: schema.requirements.id,
        title: schema.requirements.title,
        projectId: schema.requirements.projectId,
        projectName: schema.projects.name,
      })
      .from(schema.requirements)
      .innerJoin(
        schema.projects,
        eq(schema.requirements.projectId, schema.projects.id),
      )
      .where(
        and(
          eq(schema.requirements.orgId, opts.orgId),
          or(
            ilike(schema.requirements.title, like),
            ilike(schema.requirements.details, like),
          ),
        ),
      )
      .limit(perType);
    for (const r of rows) {
      results.push({
        type: "requirement",
        id: r.id,
        title: r.title,
        subtitle: r.projectName,
        href: `/projects/${r.projectId}/requirements`,
      });
    }
  }

  if (types.has("customer")) {
    const rows = await db
      .select({
        id: schema.customers.id,
        name: schema.customers.name,
        industry: schema.customers.industry,
      })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.orgId, opts.orgId),
          or(
            ilike(schema.customers.name, like),
            ilike(schema.customers.industry, like),
          ),
        ),
      )
      .limit(perType);
    for (const r of rows) {
      results.push({
        type: "customer",
        id: r.id,
        title: r.name,
        subtitle: r.industry,
        // No dedicated customer page; the Projects list is grouped by customer.
        href: "/projects",
      });
    }
  }

  return results;
}
