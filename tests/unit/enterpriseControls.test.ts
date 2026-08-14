import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { encryptSecret, decryptSecret, hashSecret } from "@/lib/crypto";
import {
  isBlockedHost,
  validateWebhookUrl,
  verifyWebhookSignature,
} from "@/server/services/webhooks";
import { validateRetentionPolicy } from "@/server/services/retention";

describe("enterprise controls", () => {
  it("encrypts secrets with authenticated context", () => {
    const encrypted = encryptSecret("client-secret", "org:connection");
    expect(decryptSecret(encrypted, "org:connection")).toBe("client-secret");
    expect(() => decryptSecret(encrypted, "other-org")).toThrow();
    expect(hashSecret("token")).not.toBe("token");
  });

  it("rejects private webhook targets", () => {
    expect(() => validateWebhookUrl("http://127.0.0.1:8787/events")).toThrow(
      /private/i,
    );
    expect(isBlockedHost("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedHost("::ffff:7f00:1")).toBe(true);
    expect(isBlockedHost("fe80::1")).toBe(true);
    expect(isBlockedHost("2001:db8::1")).toBe(true);
    expect(isBlockedHost("0.1.2.3")).toBe(true);
    expect(isBlockedHost("100.64.0.1")).toBe(true);
    expect(isBlockedHost("198.18.0.1")).toBe(true);
    expect(isBlockedHost("224.0.0.1")).toBe(true);
    expect(validateWebhookUrl("https://example.com/events").hostname).toBe(
      "example.com",
    );
  });

  it("detects signed webhook replay and tampering", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: "evt_1" });
    const signature = createHmac("sha256", "secret")
      .update(timestamp + "." + body)
      .digest("hex");
    expect(verifyWebhookSignature("secret", timestamp, body, signature)).toBe(
      true,
    );
    expect(
      verifyWebhookSignature(
        "secret",
        timestamp - 301,
        body,
        signature,
        timestamp,
      ),
    ).toBe(false);
    expect(
      verifyWebhookSignature("secret", timestamp, body + "x", signature),
    ).toBe(false);
  });

  it("keeps retention controls inside documented bounds", () => {
    expect(validateRetentionPolicy({ auditDays: 730 }).auditDays).toBe(730);
    expect(() => validateRetentionPolicy({ aiDetailDays: 10 })).toThrow();
    expect(() =>
      validateRetentionPolicy({ webhookDeliveryDays: 120 }),
    ).toThrow();
  });

  it("keeps the runtime role read-only for global user identities", () => {
    const script = readFileSync(
      new URL("../../scripts/provision-runtime-role.sql", import.meta.url),
      "utf8",
    );
    expect(script).toContain("REVOKE INSERT, UPDATE, DELETE ON TABLE users");
    expect(script).toContain("GRANT SELECT ON TABLE users");
    expect(script).toContain("\\quit 3");
    expect(script).not.toMatch(/'organizations,[^']*\busers\b/);
  });
});
