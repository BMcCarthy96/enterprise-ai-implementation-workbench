import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError } from "@/lib/api";

const UuidSchema = z.string().uuid();

/** Validate route identifiers before they reach PostgreSQL's uuid columns. */
export function uuidParam(value: string | undefined, name: string): string {
  const result = UuidSchema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, `Invalid ${name}`, "INVALID_IDENTIFIER");
  }
  return result.data;
}

/**
 * Tenant-scoped lookups. Every /api/v1 handler that touches a project-owned
 * resource goes through these, so a valid session for org A can never read or
 * mutate org B's data even with a guessed UUID.
 */
export async function requireProject(projectId: string, orgId: string) {
  projectId = uuidParam(projectId, "projectId");
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
  taskId = uuidParam(taskId, "taskId");
  const task = await db.query.tasks.findFirst({
    where: and(eq(schema.tasks.id, taskId), eq(schema.tasks.orgId, orgId)),
  });
  if (!task) throw new ApiError(404, "Task not found");
  return task;
}

export async function requireRequirement(requirementId: string, orgId: string) {
  requirementId = uuidParam(requirementId, "requirementId");
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
  documentId = uuidParam(documentId, "documentId");
  const document = await db.query.documents.findFirst({
    where: and(
      eq(schema.documents.id, documentId),
      eq(schema.documents.orgId, orgId),
    ),
  });
  if (!document) throw new ApiError(404, "Document not found");
  return document;
}
