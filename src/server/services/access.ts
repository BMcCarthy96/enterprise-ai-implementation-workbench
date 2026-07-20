import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError } from "@/lib/api";

/**
 * Tenant-scoped lookups. Every /api/v1 handler that touches a project-owned
 * resource goes through these, so a valid session for org A can never read or
 * mutate org B's data even with a guessed UUID.
 */
export async function requireProject(projectId: string, orgId: string) {
  const project = await db.query.projects.findFirst({
    where: and(
      eq(schema.projects.id, projectId),
      eq(schema.projects.orgId, orgId),
    ),
  });
  if (!project) throw new ApiError(404, "Project not found");
  return project;
}

export async function requireTask(taskId: string, orgId: string) {
  const task = await db.query.tasks.findFirst({
    where: and(eq(schema.tasks.id, taskId), eq(schema.tasks.orgId, orgId)),
  });
  if (!task) throw new ApiError(404, "Task not found");
  return task;
}

export async function requireRequirement(requirementId: string, orgId: string) {
  const requirement = await db.query.requirements.findFirst({
    where: and(
      eq(schema.requirements.id, requirementId),
      eq(schema.requirements.orgId, orgId),
    ),
  });
  if (!requirement) throw new ApiError(404, "Requirement not found");
  return requirement;
}

export async function requireDocument(documentId: string, orgId: string) {
  const document = await db.query.documents.findFirst({
    where: and(
      eq(schema.documents.id, documentId),
      eq(schema.documents.orgId, orgId),
    ),
  });
  if (!document) throw new ApiError(404, "Document not found");
  return document;
}
