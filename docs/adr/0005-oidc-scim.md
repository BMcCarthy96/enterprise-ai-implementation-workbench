# ADR 0005: OIDC plus SCIM is the enterprise identity surface

Status: Accepted

Password login remains compatible. Optional OIDC uses discovery, PKCE,
state/nonce, verified claims, and safe return paths. SCIM bearer tokens are
hashed, scoped, expirable, revocable, and mapped through explicit groups;
unmapped or conflicting roles grant no access. Membership versions invalidate
sessions immediately on suspension or role change.
