import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema, withTenantTransaction, withUserTransaction } from "@/db";
import { verifyPassword } from "@/lib/auth/password";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { recordAudit } from "@/server/services/audit";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// A fixed bcrypt hash keeps unknown-email and wrong-password requests on the
// same expensive code path, reducing credential-enumeration timing signals.
const DUMMY_PASSWORD_HASH =
  "$2b$12$50t6qVJIbPO2W9pU9MmLJem0HML00HEZuplazgT.qyHbK/dzI4Vea";

export async function POST(req: NextRequest) {
  if (env().WORKBENCH_ENV_MODE === "showcase") {
    return NextResponse.json(
      { error: "Password sign-in is disabled in the public showcase. Launch an isolated demo workspace instead." },
      { status: 403 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const { password } = parsed.data;
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });

  // Uniform error for unknown email vs wrong password.
  const invalid = NextResponse.json(
    { error: "Invalid email or password" },
    { status: 401 },
  );
  const passwordValid = await verifyPassword(
    password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  if (!user || !passwordValid) {
    logger.warn({ reason: "invalid_credentials" }, "failed login attempt");
    return invalid;
  }

  const membership = await withUserTransaction(user.id, () =>
    db
      .select({
        membershipId: schema.memberships.id,
        orgId: schema.memberships.orgId,
        role: schema.memberships.role,
        active: schema.memberships.active,
        sessionVersion: schema.memberships.sessionVersion,
        orgName: schema.organizations.name,
      })
      .from(schema.memberships)
      .innerJoin(
        schema.organizations,
        eq(schema.memberships.orgId, schema.organizations.id),
      )
      .where(eq(schema.memberships.userId, user.id))
      .limit(1),
  );

  if (membership.length === 0) {
    return NextResponse.json(
      { error: "Your account is not a member of any organization" },
      { status: 403 },
    );
  }

  const { membershipId, orgId, orgName, role, active, sessionVersion } = membership[0];
  if (!active) {
    return NextResponse.json(
      { error: "Your organization access is suspended" },
      { status: 403 },
    );
  }
  const token = await createSessionToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    orgId,
    orgName,
    role,
    membershipId,
    sessionVersion,
  });

  await withTenantTransaction(orgId, () =>
    recordAudit({
      orgId,
      actorId: user.id,
      action: "auth.login",
      subjectType: "user",
      subjectId: user.id,
    }),
    user.id,
  );

  const res = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, role, orgName },
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
