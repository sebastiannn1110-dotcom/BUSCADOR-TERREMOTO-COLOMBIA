import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

type InspectorModule = {
  EXPECTED_SCHEMA_VERSION: string;
  requiredEnvironment: string[];
  expectedTables: string[];
  expectedColumns: Record<string, string[]>;
  expectedServiceRoleVisibleRpcs: string[];
  expectedRlsTables: string[];
  expectedForcedRlsTables: string[];
  expectedBucketContracts: Record<string, { public: boolean; allowedMimeTypes: string[] }>;
  inspectEnvironment: (environment: Record<string, string | undefined>) => {
    status: Record<string, string>;
    policy: Record<string, boolean>;
  };
  createSchemaResult: (openApi: Record<string, unknown>) => unknown;
  evaluateProductionContract: (input: Record<string, unknown>) => { status: string; failures: string[] };
};

describe("inspector seguro del contrato de producción", () => {
  let inspector: InspectorModule;

  beforeAll(async () => {
    // @ts-expect-error El inspector operativo es ESM nativo sin archivo .d.ts.
    inspector = await import("../scripts/inspect-reports-production.mjs") as InspectorModule;
  });

  function validFixture() {
    const definitions = Object.fromEntries(inspector.expectedTables.map((table) => [
      table,
      {
        properties: Object.fromEntries(
          (inspector.expectedColumns[table] ?? []).map((column) => [column, { type: "string" }]),
        ),
      },
    ]));
    const paths = Object.fromEntries(inspector.expectedServiceRoleVisibleRpcs.map((name) => [
      `/rpc/${name}`,
      { post: { parameters: [] } },
    ]));
    const schemaResult = inspector.createSchemaResult({ definitions, paths, info: { version: "test" } });
    const databaseSnapshot = {
      schemaVersion: inspector.EXPECTED_SCHEMA_VERSION,
      lastMigrationApplied: inspector.EXPECTED_SCHEMA_VERSION,
      publishedCounts: { missing: 3, deceasedConfirmed: 39 },
      deceasedFilterReady: true,
      tables: [
        ...inspector.expectedRlsTables.map((name) => ({
          name,
          found: true,
          kind: "table",
          rlsEnabled: true,
          rlsForced: inspector.expectedForcedRlsTables.includes(name),
        })),
        { name: "public_case_cards", found: true, kind: "view", rlsEnabled: null, rlsForced: null },
      ],
      rpcs: [
        { name: "bootstrap_initial_admin", found: true },
        { name: "manage_staff_profile", found: true },
      ],
      buckets: Object.entries(inspector.expectedBucketContracts).map(([name, contract]) => ({
        name,
        found: true,
        public: contract.public,
        allowedMimeTypes: contract.allowedMimeTypes,
      })),
    };
    const storageBuckets = Object.entries(inspector.expectedBucketContracts).map(([name, contract]) => ({
      name,
      public: contract.public,
    }));
    const environmentInspection = inspector.inspectEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test",
      SUPABASE_SERVICE_ROLE_KEY: "service-test",
      APP_URL: "https://buscador-terremoto-colombia.onrender.com",
      IP_HASH_SECRET: "hash-test",
      ENABLE_TEST_DATA: "false",
    });
    return {
      environment: environmentInspection.status,
      environmentPolicy: environmentInspection.policy,
      schemaResult,
      databaseSnapshot,
      storageBuckets,
      bucketError: null,
      snapshotError: null
    };
  }

  it("valida la migración 006, conteos, filtro deceased, RLS y Storage", () => {
    const result = inspector.evaluateProductionContract(validFixture());
    expect(result).toEqual({ status: "OK", failures: [] });
  });

  it("no exige que manage_staff_profile sea visible o ejecutable por service_role", () => {
    expect(inspector.expectedServiceRoleVisibleRpcs).not.toContain("manage_staff_profile");
    const fixture = validFixture();
    expect((fixture.schemaResult as { schema: { rpcs: Record<string, unknown> } }).schema.rpcs)
      .not.toHaveProperty("manage_staff_profile");
    expect(inspector.evaluateProductionContract(fixture).status).toBe("OK");
  });

  it("falla ante versión, migración, RLS, visibilidad o MIME distintos", () => {
    const fixture = validFixture();
    fixture.databaseSnapshot.schemaVersion = "202608120004";
    fixture.databaseSnapshot.lastMigrationApplied = "202608120004";
    fixture.databaseSnapshot.publishedCounts.deceasedConfirmed = -1;
    fixture.databaseSnapshot.deceasedFilterReady = false;
    fixture.databaseSnapshot.tables.find((table) => table.name === "contact_followups")!.rlsEnabled = false;
    fixture.databaseSnapshot.tables.find((table) => table.name === "official_deceased_import_entries")!.rlsForced = false;
    fixture.environmentPolicy.appUrlExact = false;
    fixture.environmentPolicy.testDataDisabled = false;
    const publicBucket = fixture.databaseSnapshot.buckets.find((bucket) => bucket.name === "public-portraits")!;
    publicBucket.public = false;
    publicBucket.allowedMimeTypes = ["image/jpeg", "image/png"];
    const privateStorageBucket = fixture.storageBuckets.find((bucket) => bucket.name === "report-evidence")!;
    privateStorageBucket.public = true;

    const result = inspector.evaluateProductionContract(fixture);
    expect(result.status).toBe("FAILED");
    expect(result.failures).toEqual(expect.arrayContaining([
      "database:schema-version:mismatch",
      "database:last-migration:mismatch",
      "database:published-counts:invalid",
      "database:deceased-filter:not-ready",
      "database:rls:contact_followups:disabled",
      "database:rls:official_deceased_import_entries:not-forced",
      "environment:APP_URL:invalid",
      "environment:ENABLE_TEST_DATA:not-false",
      "database:bucket:public-portraits:visibility-mismatch",
      "database:bucket:public-portraits:mime-types-mismatch",
      "storage:bucket:report-evidence:visibility-mismatch",
    ]));
  });

  it("acepta CAPTCHA ausente o completo, pero rechaza una configuración parcial", () => {
    const disabled = inspector.inspectEnvironment({
      APP_URL: "https://buscador-terremoto-colombia.onrender.com",
      ENABLE_TEST_DATA: "false"
    });
    expect(disabled.policy.captchaConfigurationComplete).toBe(true);

    const partial = inspector.inspectEnvironment({
      APP_URL: "https://buscador-terremoto-colombia.onrender.com",
      ENABLE_TEST_DATA: "false",
      CAPTCHA_PROVIDER: "turnstile"
    });
    expect(partial.policy.captchaConfigurationComplete).toBe(false);

    const unsupported = inspector.inspectEnvironment({
      APP_URL: "https://buscador-terremoto-colombia.onrender.com",
      ENABLE_TEST_DATA: "false",
      CAPTCHA_PROVIDER: "hcaptcha",
      NEXT_PUBLIC_CAPTCHA_SITE_KEY: "site-test",
      CAPTCHA_SECRET_KEY: "secret-test"
    });
    expect(unsupported.policy.captchaConfigurationComplete).toBe(false);
  });

  it("no imprime valores de entorno ni mensajes crudos de servicios", () => {
    const source = readFileSync(resolve("scripts/inspect-reports-production.mjs"), "utf8");
    expect(source).not.toContain("bucketError.message");
    expect(source).not.toContain("snapshotError.message");
    expect(source).not.toMatch(/console\.(?:log|error)\([^\n]*(?:serviceKey|process\.env\[)/);
  });

  it("publica el inspector como comando npm de solo lectura", () => {
    expect(packageJson.scripts["inspect:production"])
      .toBe("node --env-file=.env scripts/inspect-reports-production.mjs");
  });
});
