import { describe, expect, it } from "vitest";
import {
  DEMO_VISITOR_COOKIE,
  demoVisitorKey,
} from "@/server/services/demoConfig";

describe("demo visitor identity", () => {
  it("creates a visitor cookie and keeps its key stable for that browser", () => {
    const first = demoVisitorKey(new Headers({ "x-forwarded-for": "203.0.113.10" }));
    const second = demoVisitorKey(
      new Headers({
        "x-forwarded-for": "203.0.113.10",
        cookie: `${DEMO_VISITOR_COOKIE}=${encodeURIComponent(first.visitorId)}`,
      }),
    );

    expect(first.setCookie).toBe(true);
    expect(second.setCookie).toBe(false);
    expect(second.visitorId).toBe(first.visitorId);
    expect(second.key).toBe(first.key);
  });

  it("separates two browsers that share a network address", () => {
    const first = demoVisitorKey(new Headers({ "x-forwarded-for": "203.0.113.10" }));
    const second = demoVisitorKey(new Headers({ "x-forwarded-for": "203.0.113.10" }));

    expect(second.visitorId).not.toBe(first.visitorId);
    expect(second.key).not.toBe(first.key);
  });

  it("rejects malformed visitor cookies instead of reusing them", () => {
    const identity = demoVisitorKey(
      new Headers({
        "x-forwarded-for": "203.0.113.10",
        cookie: `${DEMO_VISITOR_COOKIE}=forged-value`,
      }),
    );

    expect(identity.setCookie).toBe(true);
    expect(identity.visitorId).not.toBe("forged-value");
  });
});
