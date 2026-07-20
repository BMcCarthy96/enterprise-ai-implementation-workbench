import pino from "pino";
import { env } from "@/lib/env";

/**
 * Structured JSON logs in production (CloudWatch-friendly); pretty-printed in
 * development. Child loggers carry orgId/jobId/requestId context.
 */
export const logger = pino({
  level: env().LOG_LEVEL,
  base: { service: "workbench" },
  ...(process.env.NODE_ENV !== "production" && process.env.PRETTY_LOGS === "1"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss" },
        },
      }
    : {}),
});
