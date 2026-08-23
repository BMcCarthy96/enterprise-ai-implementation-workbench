import { InvokeCommand } from "@aws-sdk/client-lambda";
import { lambdaClient } from "@/lib/aws/clients";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/api";
import { getSessionToken, type SessionPayload } from "@/lib/auth/session";
import type * as DemoService from "@/server/services/demo";
import type { Role } from "@/lib/auth/rbac";

/**
 * The web app keeps the public demo API stable while choosing where the
 * privileged seed, reset, and quota operations run. Local development uses
 * the existing admin connection; a hosted deployment invokes the small
 * control Lambda so DATABASE_ADMIN_URL never has to live in Vercel.
 */
export interface DemoControlEvent {
  operation: "create" | "switch" | "reset" | "reserve" | "reconcile";
  ip?: string;
  sessionToken?: string;
  role?: Role;
  returnTo?: string | null;
  confirmed?: boolean;
  reservedUsd?: number;
}

export interface DemoControlSuccess<T = unknown> {
  ok: true;
  data: T;
}

interface DemoControlFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
}

type DemoControlResponse<T = unknown> = DemoControlSuccess<T> | DemoControlFailure;

type WorkspaceResult = {
  workspace: { expiresAt: Date | string } & Record<string, unknown>;
};

function normalizeWorkspaceResult<T extends WorkspaceResult>(result: T): T {
  return {
    ...result,
    workspace: {
      ...result.workspace,
      expiresAt: new Date(result.workspace.expiresAt),
    },
  } as T;
}

function controlArn(): string | undefined {
  return env().DEMO_CONTROL_FUNCTION_ARN;
}

function localControlAllowed(): boolean {
  const config = env();
  if (config.DEMO_CONTROL_FUNCTION_ARN) return false;
  if (config.WORKBENCH_ENV_MODE === "local" && config.NODE_ENV !== "production") return true;
  throw new ApiError(
    503,
    "Hosted demo control is not configured",
    "DEMO_CONTROL_UNAVAILABLE",
  );
}

async function invoke<T>(event: DemoControlEvent): Promise<T> {
  const functionName = controlArn();
  if (!functionName) {
    throw new ApiError(
      503,
      "Hosted demo control is not configured",
      "DEMO_CONTROL_UNAVAILABLE",
    );
  }
  let response;
  try {
    response = await lambdaClient().send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify(event)),
      }),
    );
  } catch {
    throw new ApiError(
      503,
      "Hosted demo control is temporarily unavailable",
      "DEMO_CONTROL_UNAVAILABLE",
    );
  }
  if (response.FunctionError) {
    throw new ApiError(
      503,
      "Hosted demo control failed",
      "DEMO_CONTROL_FAILED",
    );
  }
  let parsed: DemoControlResponse<T> | null = null;
  try {
    const payload = response.Payload
      ? new TextDecoder().decode(response.Payload)
      : "";
    parsed = JSON.parse(payload) as DemoControlResponse<T>;
  } catch {
    throw new ApiError(
      503,
      "Hosted demo control returned an invalid response",
      "DEMO_CONTROL_INVALID_RESPONSE",
    );
  }
  if (!parsed?.ok) {
    throw new ApiError(
      parsed?.status ?? 503,
      parsed?.message ?? "Hosted demo control failed",
      parsed?.code ?? "DEMO_CONTROL_FAILED",
    );
  }
  return parsed.data;
}

async function tokenOrThrow(): Promise<string> {
  const token = await getSessionToken();
  if (!token) {
    throw new ApiError(401, "Only an authenticated demo session can continue", "DEMO_SESSION_REQUIRED");
  }
  return token;
}

export async function createDemoWorkspaceControlled(ip: string) {
  if (localControlAllowed()) {
    const { createDemoWorkspace } = await import("@/server/services/demo");
    return createDemoWorkspace(ip);
  }
  const result = await invoke<Awaited<ReturnType<typeof DemoService.createDemoWorkspace>>>({
    operation: "create",
    ip,
  });
  return normalizeWorkspaceResult(result);
}

export async function switchDemoPersonaControlled(input: {
  session: SessionPayload;
  role: Role;
  returnTo?: string | null;
}) {
  if (localControlAllowed()) {
    const { switchDemoPersona } = await import("@/server/services/demo");
    return switchDemoPersona({
      workspaceId: input.session.demoWorkspaceId!,
      orgId: input.session.orgId,
      currentUserId: input.session.userId,
      role: input.role,
      returnTo: input.returnTo,
    });
  }
  const result = await invoke<Awaited<ReturnType<typeof DemoService.switchDemoPersona>>>({
    operation: "switch",
    sessionToken: await tokenOrThrow(),
    role: input.role,
    returnTo: input.returnTo,
  });
  return normalizeWorkspaceResult(result);
}

export async function replaceDemoWorkspaceControlled(input: {
  session: SessionPayload;
  ip: string;
}) {
  if (localControlAllowed()) {
    const { replaceDemoWorkspace } = await import("@/server/services/demo");
    return replaceDemoWorkspace({
      workspaceId: input.session.demoWorkspaceId!,
      orgId: input.session.orgId,
      userId: input.session.userId,
      ip: input.ip,
    });
  }
  const result = await invoke<Awaited<ReturnType<typeof DemoService.replaceDemoWorkspace>>>({
    operation: "reset",
    sessionToken: await tokenOrThrow(),
    ip: input.ip,
    confirmed: true,
  });
  return normalizeWorkspaceResult(result);
}

export async function reserveDemoGenerationControlled(input: {
  session: SessionPayload;
}) {
  if (localControlAllowed()) {
    const { reserveDemoGeneration } = await import("@/server/services/demo");
    return reserveDemoGeneration({
      orgId: input.session.orgId,
      userId: input.session.userId,
    });
  }
  return invoke<number>({
    operation: "reserve",
    sessionToken: await tokenOrThrow(),
  });
}

export async function reconcileDemoGenerationControlled(input: {
  session: SessionPayload;
  reservedUsd: number;
}) {
  if (localControlAllowed()) {
    const { reconcileDemoGeneration } = await import("@/server/services/demo");
    return reconcileDemoGeneration({
      orgId: input.session.orgId,
      reservedUsd: input.reservedUsd,
    });
  }
  await invoke<null>({
    operation: "reconcile",
    sessionToken: await tokenOrThrow(),
    reservedUsd: input.reservedUsd,
  });
}
