import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateMissingImportEnvironment } from "../scripts/import-missing";

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  CONFIRM_MISSING_IMPORT: "DESAPARECIDOS",
  MISSING_IMPORT_REASON: "Lista ficticia revisada por el equipo autorizado",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test",
  SUPABASE_ADMIN_ACCESS_TOKEN: "temporary-admin-test-token"
};

describe("CLI controlado de desaparecidos", () => {
  it("aborta sin la confirmación literal requerida", () => {
    expect(() => validateMissingImportEnvironment({ ...validEnvironment, CONFIRM_MISSING_IMPORT: "" }))
      .toThrow(/CONFIRM_MISSING_IMPORT=DESAPARECIDOS/u);
  });

  it("exige razón suficiente, HTTPS no local y token administrativo temporal", () => {
    expect(() => validateMissingImportEnvironment({ ...validEnvironment, MISSING_IMPORT_REASON: "corta" }))
      .toThrow(/entre 10 y 1000/u);
    expect(() => validateMissingImportEnvironment({ ...validEnvironment, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }))
      .toThrow(/HTTPS/u);
    expect(() => validateMissingImportEnvironment({ ...validEnvironment, SUPABASE_ADMIN_ACCESS_TOKEN: "" }))
      .toThrow(/SUPABASE_ADMIN_ACCESS_TOKEN/u);
  });

  it("está publicado con el comando npm solicitado", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["import:missing"]).toBe("tsx scripts/import-missing.ts");
  });
});
