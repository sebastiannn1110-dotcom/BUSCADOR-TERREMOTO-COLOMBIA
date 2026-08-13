type UnknownRecord = Record<string, unknown>;

const postgresFields = [
  "code",
  "details",
  "hint",
  "constraint",
  "table",
  "column",
  "schema",
  "routine",
  "severity"
] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

export function reportError(error: unknown) {
  if (error instanceof Error) {
    const result: UnknownRecord = {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null
    };

    if (isRecord(error)) {
      for (const [key, value] of Object.entries(error)) result[key] = value;
    }
    return result;
  }

  if (isRecord(error)) {
    let diagnosticDetails: UnknownRecord | null = null;
    if (typeof error.details === "string") {
      try {
        const parsed = JSON.parse(error.details) as unknown;
        if (isRecord(parsed)) diagnosticDetails = parsed;
      } catch {
        diagnosticDetails = null;
      }
    }

    const result: UnknownRecord = {
      name: typeof error.name === "string" ? error.name : "SupabaseError",
      message: typeof error.message === "string" ? error.message : null,
      stack: typeof error.stack === "string" ? error.stack : null
    };

    for (const field of postgresFields) result[field] = error[field] ?? null;
    for (const [key, value] of Object.entries(error)) result[key] = value;
    if (diagnosticDetails) {
      result.reportStep = diagnosticDetails.reportStep ?? null;
      result.constraint = diagnosticDetails.constraint ?? result.constraint;
      result.table = diagnosticDetails.table ?? result.table;
      result.column = diagnosticDetails.column ?? result.column;
      result.schema = diagnosticDetails.schema ?? result.schema;
      result.datatype = diagnosticDetails.datatype ?? null;
      result.postgresContext = diagnosticDetails.context ?? null;
    }
    return result;
  }

  return {
    name: "UnknownError",
    message: typeof error === "string" ? error : "Unknown thrown value",
    stack: null,
    value: error
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
  }, (_key, value: unknown) => {
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
