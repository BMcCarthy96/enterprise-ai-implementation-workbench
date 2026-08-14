export interface RedactionResult {
  text: string;
  counts: { email: number; phone: number; identifier: number };
}

/**
 * Remove only common direct identifiers before untrusted text is submitted to
 * a model. The source document remains governed in Postgres/S3; telemetry
 * records counts, never the original values.
 */
export function redactSensitiveText(input: string): RedactionResult {
  let text = input;
  const counts = { email: 0, phone: 0, identifier: 0 };
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, () => {
    counts.email += 1;
    return "[REDACTED_EMAIL]";
  });
  // Requirement UUIDs are integrity-bearing prompt data. Protect their spans
  // explicitly because a UUID can begin with 8-12 digits or contain a long
  // numeric tail that otherwise looks like a phone number.
  const uuidRanges = Array.from(
    text.matchAll(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi),
    (match) => {
      const start = match.index ?? 0;
      return { start, end: start + match[0].length };
    },
  );
  text = text.replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, (candidate, offset: number) => {
    const end = offset + candidate.length;
    if (uuidRanges.some((range) => offset < range.end && end > range.start)) {
      return candidate;
    }
    const value = candidate.trim();
    const digits = value.replace(/\D/g, "");
    // Preserve ISO dates and require a plausible E.164-length phone number.
    // The previous broad pattern incorrectly redacted dates such as 2026-10-30.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) || digits.length < 10 || digits.length > 15) {
      return candidate;
    }
    counts.phone += 1;
    return candidate.replace(value, "[REDACTED_PHONE]");
  });
  const identifierPatterns = [
    /\b(?:ssn|social security(?: number)?|account(?:\s+(?:id|number))?|customer(?:\s+(?:id|number))?)\s*[:#]\s*[A-Z0-9-]{4,}\b/gi,
    /\b(?:account|customer)\s+(?:id|number)\s+[A-Z0-9-]{4,}\b/gi,
  ];
  for (const pattern of identifierPatterns) {
    text = text.replace(pattern, () => {
      counts.identifier += 1;
      return "[REDACTED_IDENTIFIER]";
    });
  }
  return { text, counts };
}

export function totalRedactions(counts: RedactionResult["counts"]): number {
  return counts.email + counts.phone + counts.identifier;
}
