import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { verifyPassword } from "@/lib/auth/password";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/server/services/audit";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
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

  const { email, password } = parsed.data;
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, email.toLowerCase()),
  });

  // Uniform error for unknown email vs wrong password.
  const invalid = NextResponse.json(
    { error: "Invalid email or password" },
    { status: 401 },
  );
  if (!user) return invalid;
  if (!(await verifyPassword(password, user.passwordHash))) {
    logger.warn({ email }, "failed login attempt");
    return invalid;
  }

  const membership = await db
    .select({
      orgId: schema.memberships.orgId,
      role: schema.memberships.role,
      orgName: schema.organizations.name,
    })
    .from(schema.memberships)
    .innerJoin(
      schema.organizations,
      eq(schema.memberships.orgId, schema.organizations.id),
    )
    .where(eq(schema.memberships.userId, user.id))
    .limit(1);

  if (membership.length === 0) {
    return NextResponse.json(
      { error: "Your account is not a member of any organization" },
      { status: 403 },
    );
  }

  const { orgId, orgName, role } = membership[0];
  const token = await createSessionToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    orgId,
    orgName,
    role,
  });

  await recordAudit({
    orgId,
    actorId: user.id,
    action: "auth.login",
    subjectType: "user",
    subjectId: user.id,
  });

  const res = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, role, orgName },
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
