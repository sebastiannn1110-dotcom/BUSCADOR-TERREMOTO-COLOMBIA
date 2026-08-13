/*
 * Read-only production inspection. It reports schema and bucket metadata and
 * never prints environment values, keys, rows, contacts, or private paths.
 */
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "IP_HASH_SECRET",
  "CAPTCHA_PROVIDER",
  "NEXT_PUBLIC_CAPTCHA_SITE_KEY",
  "CAPTCHA_SECRET_KEY",
  "ENABLE_TEST_DATA"
];

const expectedTables = [
  "profiles",
  "people",
  "cases",
  "case_reports",
  "reporter_contacts",
  "media_assets",
  "status_history",
  "audit_logs",
  "submission_rate_limits",
  "public_case_cards"
];

const expectedRpcs = [
  "submit_public_report",
  "get_public_case",
  "search_public_people"
];

const expectedColumns = {
  people: ["id", "full_name", "normalized_name", "aliases", "approximate_age", "is_minor", "distinguishing_features", "private_notes"],
  cases: ["id", "person_id", "slug", "publication_status", "condition_status", "last_seen_at", "last_seen_location_private", "clothing", "circumstances_private", "urgency_level"],
  case_reports: ["id", "case_id", "report_type", "description", "is_sensitive", "tracking_code"],
  reporter_contacts: ["id", "report_id", "reporter_name", "phone", "email", "preferred_contact_method"],
  submission_rate_limits: ["request_fingerprint", "window_started_at", "submission_count", "updated_at"]
};

const environment = Object.fromEntries(requiredEnvironment.map((name) => [
  name,
  typeof process.env[name] === "string" && process.env[name].trim() !== "" ? "FOUND" : "MISSING"
]));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

console.log(JSON.stringify({ environment }, null, 2));

if (!url || !serviceKey) {
  throw new Error("Production inspection requires the Supabase URL and service role key.");
}

const response = await fetch(`${url}/rest/v1/`, {
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: "application/openapi+json"
  },
  cache: "no-store"
});

const openApi = await response.json();
if (!response.ok) {
  throw Object.assign(new Error("Supabase OpenAPI inspection failed."), {
    status: response.status,
    details: openApi
  });
}

const definitions = openApi.definitions ?? {};
const paths = openApi.paths ?? {};
console.log(JSON.stringify({
  schema: {
    openApiVersion: openApi.info?.version ?? "UNKNOWN",
    tables: Object.fromEntries(expectedTables.map((name) => [name, definitions[name] ? "FOUND" : "MISSING"])),
    columns: Object.fromEntries(Object.entries(expectedColumns).map(([table, columns]) => {
      const properties = definitions[table]?.properties ?? {};
      return [table, Object.fromEntries(columns.map((column) => [column, properties[column] ? "FOUND" : "MISSING"]))];
    })),
    rpcs: Object.fromEntries(expectedRpcs.map((name) => {
      const operation = paths[`/rpc/${name}`]?.post;
      return [name, {
        status: operation ? "FOUND" : "MISSING",
        arguments: (operation?.parameters ?? []).map((parameter) => parameter.name)
      }];
    }))
  }
}, null, 2));

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
  realtime: { transport: false }
});
const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();

console.log(JSON.stringify({
  storage: {
    buckets: (buckets ?? []).map(({ name, public: isPublic }) => ({ name, public: isPublic })),
    error: bucketError
  }
}, null, 2));
