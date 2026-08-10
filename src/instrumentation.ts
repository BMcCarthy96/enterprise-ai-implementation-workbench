import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({ serviceName: "enterprise-ai-implementation-workbench" });
}
