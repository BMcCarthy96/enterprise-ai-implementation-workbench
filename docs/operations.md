# Operations and SLO runbook

The Operations view deliberately separates observed demo data from staging
targets. It is safe to show a recruiter because it never turns an aspiration
into an uptime claim.

## Targets

- 99.5% rolling-30-day availability
- Non-AI API p95 below 750 ms and error rate below 1%
- 95% of queued jobs start within 60 seconds
- 95% of non-guardrail-blocked generation jobs reach a successful terminal state
- 95% of webhook deliveries succeed within five minutes
- 24-hour RPO and four-hour RTO

Observed windows are computed from the current tenant's jobs, webhook
deliveries, retention ledger, and traces. A window with no sample is shown as
“not measured”; it must not be promoted to Verified in the proof registry.

## Incident response

1. Check /api/health, queue age, worker errors, and the DLQ alarm.
2. Inspect the job's sanitized lastError, trace correlation, and attempts.
3. Retry only after identifying whether the failure is provider capacity,
   validation, dependency, or tenant input.
4. For webhook failures, verify endpoint ownership, DNS resolution, signature
   replay window, and response status before retrying.
5. Preserve the audit event and open a short incident note with impact,
   timeline, mitigation, and follow-up.

## Rollback and restore

- Web runtime: promote the previous Vercel deployment.
- Database: apply additive migrations forward; restore Neon to a new branch
  before selecting a recovery point.
- Queue: keep Postgres job rows authoritative and replay undelivered pointers
  with the dispatcher.
- Objects: restore versioned S3 keys under the exact orgs/{orgId}/ prefix.
- Bedrock: trip the demo circuit breaker and fall back to seeded evidence
  until the provider is healthy.

Record the staging restore duration before changing the proof claim from Target
to Verified.
