import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  sessionMembershipIsCurrent,
  verifySessionToken,
  type SessionPayload,
} from "@/lib/auth/session";

const payload: SessionPayload = {
  userId: "11111111-1111-1111-1111-111111111111",
  email: "test@example.com",
  name: "Test User",
  orgId: "22222222-2222-2222-2222-222222222222",
  orgName: "Test Org",
  role: "solutions_engineer",
};

describe("session tokens", () => {
  it("round-trips a session payload", async () => {
    const token = await createSessionToken(payload);
    const verified = await verifySessionToken(token);
    expect(verified).toMatchObject(payload);
  });

  it("rejects a tampered token", async () => {
    const token = await createSessionToken(payload);
    const tampered = token.slice(0, -5) + "AAAAA";
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifySessionToken("not-a-jwt")).toBeNull();
  });

  it("invalidates inactive or version-changed organization access", () => {
    const versioned = {
      ...payload,
      membershipId: "33333333-3333-3333-3333-333333333333",
      sessionVersion: 4,
    };
    const current = {
      id: versioned.membershipId,
      orgId: versioned.orgId,
      userId: versioned.userId,
      active: true,
      sessionVersion: 4,
    };
    expect(sessionMembershipIsCurrent(versioned, current)).toBe(true);
    expect(
      sessionMembershipIsCurrent(versioned, { ...current, active: false }),
    ).toBe(false);
    expect(
      sessionMembershipIsCurrent(versioned, { ...current, sessionVersion: 5 }),
    ).toBe(false);
    expect(sessionMembershipIsCurrent(payload, current)).toBe(false);
  });
});
