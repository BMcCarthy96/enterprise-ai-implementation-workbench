# ADR 0001: Tenant isolation is defense in depth

Status: Accepted

Organization ids are carried through domain rows and explicit predicates, then
repeated with transaction-local PostgreSQL RLS context. The runtime pool is
separate from the owner/admin pool; admin access is limited to migrations,
cleanup, SCIM, and worker source-of-truth reads. This makes a missing
application predicate fail closed rather than relying on convention alone.
