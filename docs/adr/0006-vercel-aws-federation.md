# ADR 0006: Keep deployment trust separate from runtime trust

Status: Accepted

The CDK stack models a Vercel OIDC deployment role separately from the worker
runtime role. Production web hosting must use a short-lived OIDC credential
bridge or an AWS role-bearing runtime; permanent AWS keys do not belong in
Vercel project settings.
