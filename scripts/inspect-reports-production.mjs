/*
 * Read-only production inspection. It reports only allow-listed metadata and
 * never prints environment values, keys, database rows, contacts or paths.
 */
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const EXPECTED_SCHEMA_VERSION = "202608130001";

export const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_URL",
  "IP_HASH_SECRET",
  "CAPTCHA_PROVIDER",
  "NEXT_PUBLIC_CAPTCHA_SITE_KEY",
  "CAPTCHA_SECRET_KEY",
  "ENABLE_TEST_DATA"
];

export const expectedTables = [
  "profiles",
  "people",
  "cases",
  "case_reports",
  "reporter_contacts",
  "media_assets",
  "status_history",
  "audit_logs",
  "moderation_actions",
  "contact_followups",
  "submission_rate_limits",
  "public_case_cards"
];

// OpenAPI is requested as service_role and therefore must only require RPCs
// that service_role can execute. manage_staff_profile is intentionally absent:
// its EXECUTE privilege belongs exclusively to authenticated administrators.
export const expectedServiceRoleVisibleRpcs = [
  "submit_public_report",
  "get_public_case",
  "search_public_people",
  "get_pending_people_cases",
  "review_pending_person_case",
  "get_pending_case_reports",
  "moderate_case_report",
  "get_contact_followup_queue",
  "log_contact_followup",
  "get_staff_media_asset",
  "preview_official_deceased_import",
  "import_official_deceased",
  "bootstrap_initial_admin",
  "reports_debug_snapshot"
];

// These functions are checked through the service-only diagnostics snapshot,
// not by assuming service_role can execute the authenticated-admin function.
const expectedSnapshotRpcs = ["bootstrap_initial_admin", "manage_staff_profile"];

// reports_debug_snapshot exposes RLS metadata for these physical tables. The
// public_case_cards relation is a view and is validated separately by OpenAPI.
export const expectedRlsTables = [
  "people",
  "cases",
  "case_reports",
  "reporter_contacts",
  "submission_rate_limits",
  "media_assets",
  "moderation_actions",
  "contact_followups",
  "status_history",
  "audit_logs"
];

export const expectedBucketContracts = {
  "public-portraits": {
    public: true,
    allowedMimeTypes: ["image/jpeg"]
  },
  "report-evidence": {
    public: false,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"]
  }
};

export const expectedColumns = {
  people: ["id", "full_name", "normalized_name", "aliases", "approximate_age", "is_minor", "distinguishing_features", "private_notes"],
  cases: ["id", "person_id", "slug", "publication_status", "condition_status", "verification_level", "last_seen_at", "last_seen_location_private", "last_seen_location_public", "authority_reference_private", "public_source_label", "primary_public_photo_path", "urgency_level"],
  case_reports: ["id", "case_id", "report_type", "report_context", "description", "public_description", "location_private", "location_public", "moderation_status", "is_sensitive", "tracking_code"],
  reporter_contacts: ["id", "report_id", "reporter_name", "phone", "email", "preferred_contact_method"],
  contact_followups: ["id", "case_id", "report_id", "contact_id", "target_type", "contact_method", "contact_status", "summary_private", "next_followup_at", "created_by", "created_at"],
  submission_rate_limits: ["request_fingerprint", "window_started_at", "submission_count", "updated_at"]
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactStringSet(actual, expected) {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== "string")) return false;
  const normalizedActual = [...new Set(actual)].sort();
  const normalizedExpected = [...expected].sort();
  return normalizedActual.length === normalizedExpected.length
    && normalizedActual.every((value, index) => value === normalizedExpected[index]);
}

function safeDatabaseSnapshot(snapshot) {
  if (!isRecord(snapshot)) return null;
  const allowListedTableNames = new Set([...expectedRlsTables, "public_case_cards"]);
  const allowListedRpcNames = new Set(expectedSnapshotRpcs);
  const allowListedBucketNames = new Set(Object.keys(expectedBucketContracts));

  return {
    schemaVersion: typeof snapshot.schemaVersion === "string" ? snapshot.schemaVersion : null,
    lastMigrationApplied: typeof snapshot.lastMigrationApplied === "string" ? snapshot.lastMigrationApplied : null,
    tables: Array.isArray(snapshot.tables)
      ? snapshot.tables
        .filter((item) => isRecord(item) && allowListedTableNames.has(item.name))
        .map((item) => ({
          name: item.name,
          found: item.found === true,
          kind: item.kind === "table" || item.kind === "view" ? item.kind : null,
          rlsEnabled: typeof item.rlsEnabled === "boolean" ? item.rlsEnabled : null,
          rlsForced: typeof item.rlsForced === "boolean" ? item.rlsForced : null
        }))
      : [],
    rpcs: Array.isArray(snapshot.rpcs)
      ? snapshot.rpcs
        .filter((item) => isRecord(item) && allowListedRpcNames.has(item.name))
        .map((item) => ({ name: item.name, found: item.found === true }))
      : [],
    buckets: Array.isArray(snapshot.buckets)
      ? snapshot.buckets
        .filter((item) => isRecord(item) && allowListedBucketNames.has(item.name))
        .map((item) => ({
          name: item.name,
          found: item.found === true,
          public: typeof item.public === "boolean" ? item.public : null,
          allowedMimeTypes: Array.isArray(item.allowedMimeTypes)
            ? item.allowedMimeTypes.filter((value) => typeof value === "string")
            : []
        }))
      : []
  };
}

export function evaluateProductionContract({
  environment,
  schemaResult,
  databaseSnapshot,
  storageBuckets,
  bucketError,
  snapshotError
}) {
  const failures = [];

  for (const name of requiredEnvironment) {
    if (environment?.[name] !== "FOUND") failures.push(`environment:${name}:missing`);
  }

  const schema = schemaResult?.schema;
  for (const name of expectedTables) {
    if (schema?.tables?.[name] !== "FOUND") failures.push(`openapi:table:${name}:missing`);
  }
  for (const [table, columns] of Object.entries(expectedColumns)) {
    for (const column of columns) {
      if (schema?.columns?.[table]?.[column] !== "FOUND") {
        failures.push(`openapi:column:${table}.${column}:missing`);
      }
    }
  }
  for (const name of expectedServiceRoleVisibleRpcs) {
    if (schema?.rpcs?.[name]?.status !== "FOUND") failures.push(`openapi:rpc:${name}:missing`);
  }

  if (bucketError) failures.push("storage:list-buckets:error");
  if (snapshotError) failures.push("database:debug-snapshot:error");

  const snapshot = safeDatabaseSnapshot(databaseSnapshot);
  if (!snapshot) {
    failures.push("database:debug-snapshot:invalid");
  } else {
    if (snapshot.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
      failures.push("database:schema-version:mismatch");
    }
    if (snapshot.lastMigrationApplied !== EXPECTED_SCHEMA_VERSION) {
      failures.push("database:last-migration:mismatch");
    }

    const tablesByName = new Map(snapshot.tables.map((item) => [item.name, item]));
    for (const name of expectedRlsTables) {
      const table = tablesByName.get(name);
      if (!table?.found) failures.push(`database:table:${name}:missing`);
      else if (table.kind !== "table" || table.rlsEnabled !== true) {
        failures.push(`database:rls:${name}:disabled`);
      }
    }

    const rpcsByName = new Map(snapshot.rpcs.map((item) => [item.name, item]));
    for (const name of expectedSnapshotRpcs) {
      if (!rpcsByName.get(name)?.found) failures.push(`database:rpc:${name}:missing`);
    }

    const snapshotBucketsByName = new Map(snapshot.buckets.map((item) => [item.name, item]));
    for (const [name, expected] of Object.entries(expectedBucketContracts)) {
      const bucket = snapshotBucketsByName.get(name);
      if (!bucket?.found) failures.push(`database:bucket:${name}:missing`);
      else {
        if (bucket.public !== expected.public) failures.push(`database:bucket:${name}:visibility-mismatch`);
        if (!exactStringSet(bucket.allowedMimeTypes, expected.allowedMimeTypes)) {
          failures.push(`database:bucket:${name}:mime-types-mismatch`);
        }
      }
    }
  }

  const storageBucketsByName = new Map(
    (Array.isArray(storageBuckets) ? storageBuckets : [])
      .filter((bucket) => isRecord(bucket) && typeof bucket.name === "string")
      .map((bucket) => [bucket.name, bucket])
  );
  for (const [name, expected] of Object.entries(expectedBucketContracts)) {
    const bucket = storageBucketsByName.get(name);
    if (!bucket) failures.push(`storage:bucket:${name}:missing`);
    else if (bucket.public !== expected.public) failures.push(`storage:bucket:${name}:visibility-mismatch`);
  }

  return { status: failures.length === 0 ? "OK" : "FAILED", failures };
}

export function createSchemaResult(openApi) {
  const definitions = openApi.definitions ?? {};
  const paths = openApi.paths ?? {};
  return {
    schema: {
      openApiVersion: openApi.info?.version ?? "UNKNOWN",
      tables: Object.fromEntries(expectedTables.map((name) => [name, definitions[name] ? "FOUND" : "MISSING"])),
      columns: Object.fromEntries(Object.entries(expectedColumns).map(([table, columns]) => {
        const properties = definitions[table]?.properties ?? {};
        return [table, Object.fromEntries(columns.map((column) => [column, properties[column] ? "FOUND" : "MISSING"]))];
      })),
      rpcs: Object.fromEntries(expectedServiceRoleVisibleRpcs.map((name) => {
        const operation = paths[`/rpc/${name}`]?.post;
        return [name, {
          status: operation ? "FOUND" : "MISSING",
          arguments: (operation?.parameters ?? []).map((parameter) => parameter.name)
        }];
      }))
    }
  };
}

export async function main() {
  const environment = Object.fromEntries(requiredEnvironment.map((name) => [
    name,
    typeof process.env[name] === "string" && process.env[name].trim() !== "" ? "FOUND" : "MISSING"
  ]));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  console.log(JSON.stringify({ environment }, null, 2));

  if (!url || !serviceKey) {
    console.error(JSON.stringify({ status: "ERROR", operation: "production-inspection", reason: "required-connection-environment-missing" }));
    process.exitCode = 2;
    return;
  }

  const response = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/openapi+json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    console.error(JSON.stringify({ status: "ERROR", operation: "openapi-inspection", httpStatus: response.status }));
    process.exitCode = 2;
    return;
  }

  const schemaResult = createSchemaResult(await response.json());
  console.log(JSON.stringify(schemaResult, null, 2));

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: false }
  });
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  const { data: databaseSnapshot, error: snapshotError } = await supabase.rpc("reports_debug_snapshot");
  const safeSnapshot = safeDatabaseSnapshot(databaseSnapshot);
  const expectedBucketNames = new Set(Object.keys(expectedBucketContracts));
  const safeStorageBuckets = (buckets ?? [])
    .filter((bucket) => expectedBucketNames.has(bucket.name))
    .map(({ name, public: isPublic }) => ({ name, public: isPublic }));

  console.log(JSON.stringify({
    storage: {
      buckets: safeStorageBuckets,
      status: bucketError ? "ERROR" : "OK"
    },
    database: snapshotError
      ? { status: "ERROR", code: snapshotError.code || "DATABASE_ERROR" }
      : { status: "OK", snapshot: safeSnapshot }
  }, null, 2));

  const validation = evaluateProductionContract({
    environment,
    schemaResult,
    databaseSnapshot,
    storageBuckets: buckets,
    bucketError,
    snapshotError
  });
  console.log(JSON.stringify({ validation }, null, 2));
  if (validation.status !== "OK") process.exitCode = 2;
}

const directEntryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (directEntryUrl === import.meta.url) {
  main().catch(() => {
    console.error(JSON.stringify({ status: "ERROR", operation: "production-inspection", reason: "unexpected-failure" }));
    process.exitCode = 2;
  });
}
