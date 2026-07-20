import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getSession, type SessionPayload } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/rbac";
import { logger } from "@/lib/logger";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export interface ApiContext {
  session: SessionPayload;
  requestId: string;
  log: typeof logger;
}

type Handler<P> = (
  req: NextRequest,
  ctx: ApiContext,
  params: P,
) => Promise<NextResponse | Response>;

/**
 * Wraps a route handler with session auth, an optional RBAC permission check,
 * a per-request child logger, and consistent JSON error responses.
 */
export function withAuth<P = Record<string, never>>(
  permission: Permission | null,
  handler: Handler<P>,
) {
  return async (
    req: NextRequest,
    route?: { params: Promise<P> },
  ): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const log = logger.child({
      requestId,
      method: req.method,
      path: req.nextUrl.pathname,
    });
    try {
      const session = await getSession();
      if (!session) {
        return NextResponse.json(
          { error: "Authentication required", requestId },
          { status: 401 },
        );
      }
      if (permission && !can(session.role, permission)) {
        log.warn(
          { userId: session.userId, role: session.role, permission },
          "permission denied",
        );
        return NextResponse.json(
          { error: "You do not have permission to perform this action", requestId },
          { status: 403 },
        );
      }
      const params = route ? await route.params : ({} as P);
      const res = await handler(req, { session, requestId, log }, params);
      return res;
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(
          { error: err.message, code: err.code, requestId },
          { status: err.status },
        );
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          {
            error: "Validation failed",
            issues: err.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
            requestId,
          },
          { status: 400 },
        );
      }
      log.error({ err }, "unhandled API error");
      return NextResponse.json(
        { error: "Internal server error", requestId },
        { status: 500 },
      );
    }
  };
}

/** Parse and validate a JSON body against a zod schema (400 on failure). */
export async function parseBody<T>(
  req: NextRequest,
  schema: ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }
  return schema.parse(raw);
}
