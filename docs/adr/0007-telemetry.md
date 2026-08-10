# ADR 0007: Trace the workflow, never the tenant content

Status: Accepted

OpenTelemetry spans cover authentication, tenant transactions, retrieval,
generation/repair, approval, dispatch, worker execution, and webhooks. Only
safe booleans, operation types, provider names, latency, and correlation
context are exported. Emails, prompts, model output, documents, tokens, and
raw organization ids are excluded.
