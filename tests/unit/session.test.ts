import { describe, expect, it } from "vitest";
import {
  createSessionToken,
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
});
