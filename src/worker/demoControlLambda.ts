import {
  createDemoWorkspace,
  DEMO_PERSONA_ROLES,
  reconcileDemoGeneration,
  replaceDemoWorkspace,
  reserveDemoGeneration,
  switchDemoPersona,
} from "@/server/services/demo";
import { verifySessionToken, type SessionPayload } from "@/lib/auth/session";
import type { Role } from "@/lib/auth/rbac";
import { ApiError } from "@/lib/api";

export interface DemoControlEvent {
  operation: "create" | "switch" | "reset" | "reserve" | "reconcile";
  visitorKey?: string;
  sessionToken?: string;
  role?: Role;
  returnTo?: string | null;
  confirmed?: boolean;
  reservedUsd?: number;
}

export type DemoControlResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; code: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseEvent(value: unknown): DemoControlEvent {
  const event = isRecord(value) ? value : null;
  const operation = event?.operation;
  if (
    operation !== "create" &&
    operation !== "switch" &&
    operation !== "reset" &&
    operation !== "reserve" &&
    operation !== "reconcile"
  ) {
    throw new ApiError(400, "Unknown demo control operation", "DEMO_OPERATION_INVALID");
  }
  const role = event?.role;
  if (role !== undefined && !DEMO_PERSONA_ROLES.includes(role as Role)) {
    throw new ApiError(400, "Unknown demo persona", "DEMO_ROLE_INVALID");
  }
  return {
    operation,
    visitorKey: typeof event?.visitorKey === "string" ? event.visitorKey : undefined,
    sessionToken: typeof event?.sessionToken === "string" ? event.sessionToken : undefined,
    role: role as Role | undefined,
    returnTo: typeof event?.returnTo === "string" ? event.returnTo : null,
    confirmed: event?.confirmed === true,
    reservedUsd: typeof event?.reservedUsd === "number" ? event.reservedUsd : undefined,
  };
}

async function authenticatedDemoSession(event: DemoControlEvent): Promise<SessionPayload> {
  if (!event.sessionToken) {
    throw new ApiError(401, "A signed demo session is required", "DEMO_SESSION_REQUIRED");
  }
  const session = await verifySessionToken(event.sessionToken);
  if (!session?.demoWorkspaceId) {
    throw new ApiError(401, "A signed demo session is required", "DEMO_SESSION_REQUIRED");
  }
  return session;
}

export async function handler(event: unknown): Promise<DemoControlResult> {
  try {
    const input = parseEvent(event);
    switch (input.operation) {
      case "create":
        if (!input.visitorKey) {
          throw new ApiError(400, "A demo visitor key is required", "DEMO_VISITOR_REQUIRED");
        }
        return { ok: true, data: await createDemoWorkspace(input.visitorKey) };
      case "switch": {
        const session = await authenticatedDemoSession(input);
        if (!input.role) {
          throw new ApiError(400, "A valid demo role is required", "DEMO_ROLE_INVALID");
        }
        return {
          ok: true,
          data: await switchDemoPersona({
            workspaceId: session.demoWorkspaceId!,
            orgId: session.orgId,
            currentUserId: session.userId,
            role: input.role,
            returnTo: input.returnTo,
          }),
        };
      }
      case "reset": {
        const session = await authenticatedDemoSession(input);
        if (!input.confirmed || !input.visitorKey) {
          throw new ApiError(400, "Reset requires explicit confirmation", "RESET_CONFIRMATION_REQUIRED");
        }
        return {
          ok: true,
          data: await replaceDemoWorkspace({
            workspaceId: session.demoWorkspaceId!,
            orgId: session.orgId,
            userId: session.userId,
            visitorKey: input.visitorKey,
          }),
        };
      }
      case "reserve": {
        const session = await authenticatedDemoSession(input);
        return {
          ok: true,
          data: await reserveDemoGeneration({ orgId: session.orgId, userId: session.userId }),
        };
      }
      case "reconcile": {
        const session = await authenticatedDemoSession(input);
        if (!input.reservedUsd || input.reservedUsd <= 0) {
          return { ok: true, data: null };
        }
        await reconcileDemoGeneration({ orgId: session.orgId, reservedUsd: input.reservedUsd });
        return { ok: true, data: null };
      }
    }
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    const code = error instanceof ApiError ? error.code ?? "DEMO_CONTROL_FAILED" : "DEMO_CONTROL_FAILED";
    const message = error instanceof Error ? error.message : "Demo control is unavailable";
    return { ok: false, status, code, message };
  }
}
