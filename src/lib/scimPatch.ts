const PATCHABLE_ATTRIBUTES: Record<
  string,
  "userName" | "displayName" | "externalId" | "active"
> = {
  username: "userName",
  displayname: "displayName",
  externalid: "externalId",
  active: "active",
};

function normalizeActive(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^(true|false)$/i.test(value)) {
    return value.toLowerCase() === "true";
  }
  throw new Error("active must be a boolean");
}

function normalizeStringAttribute(
  attribute: "userName" | "displayName" | "externalId",
  value: unknown,
): string {
  if (typeof value !== "string") {
    throw new Error(`${attribute} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) throw new Error(`${attribute} must not be empty`);
  if (attribute === "userName" && !normalized.includes("@")) {
    throw new Error("userName must be an email address");
  }
  return normalized;
}

function setPatchValue(
  result: Record<string, unknown>,
  rawPath: string,
  value: unknown,
) {
  const attribute = PATCHABLE_ATTRIBUTES[rawPath.trim().toLowerCase()];
  if (!attribute) throw new Error(`Unsupported SCIM PATCH path: ${rawPath}`);
  result[attribute] =
    attribute === "active"
      ? normalizeActive(value)
      : normalizeStringAttribute(attribute, value);
}

/**
 * Normalize SCIM PatchOp payloads into the user-update shape accepted by the
 * service layer. Providers differ in casing and whether they use a path or a
 * pathless value object, so both forms are handled deliberately. Unsupported
 * operations fail closed instead of returning a misleading 200 response.
 */
export function applyScimUserPatchOperations(
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(input.Operations) || input.Operations.length === 0) {
    throw new Error("SCIM PATCH requires at least one operation");
  }

  const result: Record<string, unknown> = {};
  for (const rawOperation of input.Operations) {
    if (!rawOperation || typeof rawOperation !== "object") {
      throw new Error("Each SCIM PATCH operation must be an object");
    }
    const operation = rawOperation as {
      op?: unknown;
      path?: unknown;
      value?: unknown;
    };
    const op =
      typeof operation.op === "string" ? operation.op.toLowerCase() : "";
    if (op !== "add" && op !== "replace" && op !== "remove") {
      throw new Error(
        `Unsupported SCIM PATCH operation: ${String(operation.op ?? "missing")}`,
      );
    }

    if (typeof operation.path === "string" && operation.path.trim()) {
      if (op === "remove") {
        const normalizedPath = operation.path.trim().toLowerCase();
        if (normalizedPath === "active") {
          result.active = false;
          continue;
        }
        if (normalizedPath === "externalid") {
          result.externalId = null;
          continue;
        }
        throw new Error(
          `SCIM PATCH remove is not supported for ${operation.path}`,
        );
      }
      if (operation.value === undefined)
        throw new Error(`SCIM PATCH ${op} requires a value`);
      setPatchValue(result, operation.path, operation.value);
      continue;
    }

    if (op === "remove") throw new Error("SCIM PATCH remove requires a path");
    if (
      !operation.value ||
      typeof operation.value !== "object" ||
      Array.isArray(operation.value)
    ) {
      throw new Error(
        `SCIM PATCH ${op} without a path requires an object value`,
      );
    }
    for (const [path, value] of Object.entries(
      operation.value as Record<string, unknown>,
    )) {
      setPatchValue(result, path, value);
    }
  }

  if (Object.keys(result).length === 0)
    throw new Error("SCIM PATCH did not contain a supported change");
  return result;
}
