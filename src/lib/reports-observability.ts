type UnknownRecord = Record<string, unknown>;

const postgresFields = [
  "code",
  "hint",
  "constraint",
  "table",
  "column",
  "schema",
  "routine",
  "severity"
] as const;

const sensitiveKeyPattern = /authorization|cookie|secret|token|tracking|api[_-]?key|service[_-]?role|phone|email|reporter|contact|private[_-]?path|storage[_-]?path|filename|payload|details|postgresContext/i;
const emailPattern = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/gu;
const phonePattern = /(?:\+?\d[\d\s()\-]{6,}\d)/gu;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~-]+/giu;
const jwtPattern = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function redactString(value: string) {
  return value
    .replace(emailPattern, "[REDACTED_EMAIL]")
    .replace(phonePattern, "[REDACTED_PHONE]")
    .replace(bearerPattern, "Bearer [REDACTED]")
    .replace(jwtPattern, "[REDACTED_TOKEN]");
}

function safeValue(key: string, value: unknown): unknown {
  if (key === "timestamp" && typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
  if (key === "requestId" && typeof value === "string" && /^[0-9a-f-]{36}$/iu.test(value)) return value;
  if (sensitiveKeyPattern.test(key)) return value == null ? null : "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  return value;
}

export function reportError(error: unknown) {
  if (error instanceof Error) {
    const result: UnknownRecord = {
      name: error.name,
      message: redactString(error.message),
      stack: error.stack ? redactString(error.stack) : null
    };

    if (isRecord(error)) {
      for (const field of postgresFields) result[field] = safeValue(field, error[field] ?? null);
      if (error.details != null) result.details = "[REDACTED_DATABASE_DETAILS]";
    }
    return result;
  }

  if (isRecord(error)) {
    const result: UnknownRecord = {
      name: typeof error.name === "string" ? error.name : "SupabaseError",
      message: typeof error.message === "string" ? redactString(error.message) : null,
      stack: typeof error.stack === "string" ? redactString(error.stack) : null
    };

    for (const field of postgresFields) result[field] = safeValue(field, error[field] ?? null);
    if (error.details != null) {
      result.details = "[REDACTED_DATABASE_DETAILS]";
      if (typeof error.details === "string") {
        try {
          const parsed = JSON.parse(error.details) as unknown;
          if (isRecord(parsed)) {
            result.reportStep = safeValue("reportStep", parsed.reportStep ?? null);
            result.constraint = safeValue("constraint", parsed.constraint ?? result.constraint);
            result.table = safeValue("table", parsed.table ?? result.table);
            result.column = safeValue("column", parsed.column ?? result.column);
            result.schema = safeValue("schema", parsed.schema ?? result.schema);
            result.datatype = safeValue("datatype", parsed.datatype ?? null);
          }
        } catch {
          // Raw diagnostics may contain a failing row. Their presence is noted
          // without writing user-provided values to production logs.
        }
      }
    }
    return result;
  }

  return {
    name: "UnknownError",
    message: typeof error === "string" ? redactString(error) : "Unknown thrown value",
    stack: null,
    valueType: typeof error
  };
}

export function reportsLog(
  level: "info" | "error",
  step: string,
  context: UnknownRecord = {}
) {
  const seen = new WeakSet<object>();
  const entry = JSON.stringify({
    scope: "REPORTS",
    step,
    timestamp: new Date().toISOString(),
    ...context
  }, (key, value: unknown) => {
    const safe = safeValue(key, value);
    if (safe !== value) return safe;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  });

  if (level === "error") {
    console.error(`[REPORTS] ${step}`, entry);
  } else {
    console.info(`[REPORTS] ${step}`, entry);
  }
}
