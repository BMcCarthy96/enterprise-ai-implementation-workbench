# Contributing

Thanks for helping improve the Workbench. Keep changes small, evidence-backed,
and compatible with the synthetic demo.

1. Create a branch from main.
2. Copy .env.example to .env, start Docker Compose, migrate, and seed.
3. Run npm run lint, npm run typecheck, npm test, npm run eval:offline,
   npm run eval:check, and npm run proof:check.
4. Add or update unit/e2e coverage for behavior changes. Never add real
   credentials, customer data, prompts, model output, or tokens to fixtures.
5. Describe tenant, audit, retention, and rollback implications in the PR.

Use the enterprise Docker profile for OIDC work:

    docker compose --profile enterprise up -d keycloak

Use the observability profile for local traces and metrics:

    docker compose --profile observability up -d

Security reports belong in SECURITY.md, not public issues.
