import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";

const tracer = trace.getTracer("enterprise-ai-workbench");

export function activeTraceContext(): { traceId?: string; traceParent?: string } {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext?.traceId) return {};
  return {
    traceId: spanContext.traceId,
    traceParent: "00-" + spanContext.traceId + "-" + spanContext.spanId + "-" + spanContext.traceFlags.toString(16).padStart(2, "0"),
  };
}

export function safeTraceAttributes(attributes: Record<string, string | number | boolean | undefined>) {
  return Object.fromEntries(Object.entries(attributes).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined));
}

export async function withSpan<T>(name: string, attributes: Record<string, string | number | boolean | undefined>, operation: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: safeTraceAttributes(attributes) }, async (span) => {
    try {
      return await operation(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
