import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeOfficialDeceasedCsv,
  officialDeceasedCsvHeaders,
  parseOfficialDeceasedCsv,
  runOfficialDeceasedImport,
  toOfficialDeceasedRpcRows,
  validateImportEnvironment,
  type OfficialImportRpc,
} from "../scripts/import-official-deceased-from-csv";

const csvPath = resolve("data/imports/medicina-legal-fallecidos-captura-2026-08-13.csv");
const csvBytes = readFileSync(csvPath);
const csv = decodeOfficialDeceasedCsv(csvBytes);
const rows = parseOfficialDeceasedCsv(csv);

const expectedNames = [
  "Anselmo Guevara Navarro",
  "Carlos Alberto Jaramillo Duque",
  "Julián Arango Hernández",
  "Jorge Luis Muñoz Marín",
  "Jorge Luis Guevara Aguilar",
  "María Catalina López Vasquez",
  "Teresita Meza de López",
  "Iván Felipe Morales Grajales",
  "Kevin Diaz Hernández",
  "Flor María Martínez de Chaux",
  "Maria Cristina Giraldo Hernández",
  "Gloria Amparo Monsalve Álvarez",
  "Ceneida Ramírez Arango",
  "Richard Alejandro Cardona Cañaveral",
  "María Melida Toro de Sossa",
  "Susana López de Guzman",
  "Leidy Marcela Morales Arias",
  "Alberto Gómez Agudelo",
  "Ofelia Franco de Zapata",
  "Luz María Hinestroza Renteria",
  "Mario Ceballos Jaramillo",
  "María Dolores Hoyos de Ruiz",
  "Carlos Alberto Guzman López",
  "Nubia Bonilla Alzate",
  "Arnulfo Galeano Buitrago",
  "Carlos Hernán Escarria Maldonado",
  "Humberto Aguirre García",
  "Cinthia Silieth Ortega Serrano",
  "Ana Silvia Rodríguez Daza",
  "Miguel Ángel Fernández Estrada",
  "Carlos Augusto Vargas Rodríguez",
  "Ana Victoria Mejía Osorio",
  "Luis Carlos Velasco Gutiérrez",
  "José Manuel Castaño Tejada",
  "Daniel Gutiérrez Arias",
  "Carlos Ernesto Rennella Campo",
  "Dey Levy Potosí Arango",
  "Carlos Andrés Cortés Palacios",
  "Omar Esquivel González",
];

describe("CSV oficial Medicina Legal 65–103", () => {
  it("está en UTF-8, tiene la cabecera exacta y exactamente 39 filas", () => {
    expect(csvBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(csv).not.toContain("\uFFFD");
    expect(csv.split(/\r?\n/u)[0]).toBe(officialDeceasedCsvHeaders.join(","));
    expect(rows).toHaveLength(39);
    expect(rows.map((row) => row.source_row)).toEqual(Array.from({ length: 39 }, (_, index) => index + 65));
    expect(new Set(rows.map((row) => row.source_row)).size).toBe(39);
  });

  it("conserva literalmente los 39 nombres suministrados y los campos controlados", () => {
    expect(rows.map((row) => row.full_name)).toEqual(expectedNames);
    expect(rows.every((row) => row.source_name === "Medicina Legal")).toBe(true);
    expect(rows.every((row) => row.source_reference === "Lista Medicina Legal aportada por administrador - captura 2026-08-13")).toBe(true);
    expect(rows.every((row) => row.public_description === "Información tomada de las listas de Medicina Legal.")).toBe(true);
    expect(rows.every((row) => row.last_seen_location_public === row.reported_unit)).toBe(true);
    expect(rows.every((row) => row.date_confirmed === "")).toBe(true);
  });

  it("envía source_row y reported_unit al RPC, pero omite gender", () => {
    const payload = toOfficialDeceasedRpcRows(rows);
    expect(payload).toHaveLength(39);
    expect(payload[0]).toEqual(expect.objectContaining({ source_row: 65, reported_unit: "Pereira" }));
    expect(payload[38]).toEqual(expect.objectContaining({ source_row: 103, reported_unit: "Cali" }));
    expect(payload.every((row) => !("gender" in row))).toBe(true);
    expect(new Set(payload.map((row) => `${row.source_reference}:${row.source_row}`)).size).toBe(39);
  });

  it("rechaza cabecera alterada, source_row repetido, edad inválida y referencia vacía", () => {
    expect(() => parseOfficialDeceasedCsv(csv.replace("source_row,", "row_number,"))).toThrow(/columnas.*exactamente/i);
    const duplicateSourceRow = csv.replace(/^66,Pereira/mu, "65,Pereira");
    expect(() => parseOfficialDeceasedCsv(duplicateSourceRow)).toThrow(/repite source_row 65/i);
    const invalidAge = csv.replace("65,Pereira,Anselmo Guevara Navarro,Masculino,76,", "65,Pereira,Anselmo Guevara Navarro,Masculino,121,");
    expect(() => parseOfficialDeceasedCsv(invalidAge)).toThrow(/approximate_age fuera de rango/i);
    const missingReference = csv.replace(
      "Medicina Legal,Lista Medicina Legal aportada por administrador - captura 2026-08-13,",
      "Medicina Legal,,",
    );
    expect(() => parseOfficialDeceasedCsv(missingReference)).toThrow(/requiere source_reference/i);
  });

  it("rechaza reported_unit vacío o divergente de la ubicación pública", () => {
    expect(() => parseOfficialDeceasedCsv(csv.replace("65,Pereira,Anselmo", "65,,Anselmo"))).toThrow(/reported_unit/i);
    expect(() => parseOfficialDeceasedCsv(csv.replace("Pereira,\n66", "Cali,\n66"))).toThrow(/copiar reported_unit/i);
  });
});

describe("guardas y contrato del CLI oficial", () => {
  const validEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    CONFIRM_OFFICIAL_IMPORT: "MEDICINA_LEGAL",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-value",
    SUPABASE_ADMIN_ACCESS_TOKEN: "admin-access-token-value",
    OFFICIAL_IMPORT_REASON: "Importación oficial revisada por administración",
  };

  it("exige confirmación literal, token admin, URL, clave publicable y razón segura", () => {
    expect(() => validateImportEnvironment({ ...validEnvironment, CONFIRM_OFFICIAL_IMPORT: undefined })).toThrow(/CONFIRM_OFFICIAL_IMPORT=MEDICINA_LEGAL/i);
    expect(() => validateImportEnvironment({ ...validEnvironment, SUPABASE_ADMIN_ACCESS_TOKEN: undefined })).toThrow(/SUPABASE_ADMIN_ACCESS_TOKEN/i);
    expect(() => validateImportEnvironment({ ...validEnvironment, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" })).toThrow(/HTTPS.*localhost/i);
    expect(() => validateImportEnvironment({ ...validEnvironment, OFFICIAL_IMPORT_REASON: "corta" })).toThrow(/10 y 1000/i);
    expect(() => validateImportEnvironment({ ...validEnvironment, OFFICIAL_IMPORT_REASON: "Usar Bearer eyJabcdefghijklmnopqrstuv.payload" })).toThrow(/credencial/i);
    expect(validateImportEnvironment(validEnvironment)).toEqual(expect.objectContaining({
      url: "https://project.supabase.co",
      reason: "Importación oficial revisada por administración",
    }));
  });

  it("si el replay ya existe, preserva la idempotencia compuesta y reporta solo agregados", async () => {
    const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
    const rpc: OfficialImportRpc = async (name, parameters) => {
      calls.push({ name, parameters });
      if (name === "preview_official_deceased_import") {
        return { data: rows.map(() => ({ decision: "already_imported" })), error: null };
      }
      return { data: { created: 0, updated: 0, skipped: 39, alreadyImported: 39, total: 39 }, error: null };
    };

    const summary = await runOfficialDeceasedImport(rows, validEnvironment.OFFICIAL_IMPORT_REASON!, rpc);
    expect(summary).toEqual({
      status: "ok",
      total: 39,
      created: 0,
      updated: 0,
      alreadyImported: 39,
      duplicatesBlocked: 0,
      errors: 0,
    });
    expect(calls.map((call) => call.name)).toEqual([
      "preview_official_deceased_import",
      "import_official_deceased",
    ]);
    const rpcRows = calls[0].parameters.p_rows as Array<Record<string, unknown>>;
    expect(rpcRows).toHaveLength(39);
    expect(rpcRows[0]).toEqual(expect.objectContaining({ source_row: 65, reported_unit: "Pereira" }));
    expect(rpcRows[0]).not.toHaveProperty("gender");
  });

  it("bloquea atómicamente una vista previa ambigua sin llamar import", async () => {
    const calls: string[] = [];
    const rpc: OfficialImportRpc = async (name) => {
      calls.push(name);
      return {
        data: rows.map((_, index) => ({ decision: index === 0 ? "review_required" : "create" })),
        error: null,
      };
    };
    await expect(runOfficialDeceasedImport(rows, validEnvironment.OFFICIAL_IMPORT_REASON!, rpc)).resolves.toEqual({
      status: "blocked",
      total: 39,
      created: 0,
      updated: 0,
      alreadyImported: 0,
      duplicatesBlocked: 1,
      errors: 0,
    });
    expect(calls).toEqual(["preview_official_deceased_import"]);
  });

  it("no filtra mensajes, details ni nombres provenientes de un error Supabase", async () => {
    const rpc = (async () => ({
      data: null,
      error: {
        code: "42501",
        message: `falló la fila ${expectedNames[0]}`,
        details: expectedNames[1],
      },
    })) as OfficialImportRpc;
    let captured = "";
    try {
      await runOfficialDeceasedImport(rows, validEnvironment.OFFICIAL_IMPORT_REASON!, rpc);
    } catch (error) {
      captured = error instanceof Error ? error.message : String(error);
    }
    expect(captured).toContain("code=42501");
    expect(captured).not.toContain(expectedNames[0]);
    expect(captured).not.toContain(expectedNames[1]);
  });

  it("publica el comando npm exacto sin ejecutarlo durante tests", () => {
    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["import:official-deceased"]).toBe("tsx scripts/import-official-deceased-from-csv.ts");
  });
});
