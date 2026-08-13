import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { hasObviousContactData } from "@/lib/request-security";

export const officialDeceasedCsvHeaders = [
  "source_row",
  "reported_unit",
  "full_name",
  "gender",
  "approximate_age",
  "source_name",
  "source_reference",
  "public_description",
  "last_seen_location_public",
  "date_confirmed",
] as const;

export type OfficialDeceasedSourceRow = {
  source_row: number;
  reported_unit: string;
  full_name: string;
  gender: string;
  approximate_age: number | null;
  source_name: "Medicina Legal";
  source_reference: string;
  public_description: string;
  last_seen_location_public: string;
  date_confirmed: string;
};

export type OfficialDeceasedRpcRow = Omit<OfficialDeceasedSourceRow, "gender">;

export type ImportEnvironment = {
  url: string;
  publishableKey: string;
  accessToken: string;
  reason: string;
};

type RpcError = { code?: string | null };
type RpcResponse = { data: unknown; error: RpcError | null };
export type OfficialImportRpc = (
  functionName: "preview_official_deceased_import" | "import_official_deceased",
  parameters: Record<string, unknown>,
) => Promise<RpcResponse>;

function createOfficialImportRpc(environment: ImportEnvironment): OfficialImportRpc {
  return async (functionName, parameters) => {
    const response = await fetch(`${environment.url}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: {
        apikey: environment.publishableKey,
        Authorization: `Bearer ${environment.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parameters),
    });
    const body = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const code = body && typeof body === "object" && !Array.isArray(body) && "code" in body
        ? String((body as { code?: unknown }).code ?? "HTTP_ERROR")
        : `HTTP_${response.status}`;
      return { data: null, error: { code } };
    }
    return { data: body, error: null };
  };
}

export type PreviewSummary = {
  total: number;
  create: number;
  update: number;
  alreadyImported: number;
  reviewRequired: number;
};

export type ImportSummary = {
  status: "ok" | "blocked";
  total: number;
  created: number;
  updated: number;
  alreadyImported: number;
  duplicatesBlocked: number;
  errors: number;
};

const MAX_CSV_BYTES = 512 * 1024;
const MAX_ROWS = 500;
const CONFIRMATION_VALUE = "MEDICINA_LEGAL";

function parseCsvMatrix(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("El CSV contiene una comilla sin cerrar.");
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function requiredText(value: string, rowNumber: number, field: string, maximum: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`La fila ${rowNumber} requiere ${field}.`);
  if (trimmed.length > maximum) throw new Error(`La fila ${rowNumber} supera el límite de ${field}.`);
  return trimmed;
}

function parseInteger(
  value: string,
  rowNumber: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) throw new Error(`La fila ${rowNumber} requiere ${field} entero.`);
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`La fila ${rowNumber} tiene ${field} fuera de rango.`);
  }
  return parsed;
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function decodeOfficialDeceasedCsv(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_CSV_BYTES) throw new Error("El CSV supera el límite de 512 KB.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("El CSV debe estar codificado en UTF-8 válido.");
  }
}

export function parseOfficialDeceasedCsv(csv: string): OfficialDeceasedSourceRow[] {
  if (new TextEncoder().encode(csv).byteLength > MAX_CSV_BYTES) {
    throw new Error("El CSV supera el límite de 512 KB.");
  }
  const matrix = parseCsvMatrix(csv.replace(/^\uFEFF/u, ""));
  if (!matrix.length) throw new Error("El CSV está vacío.");

  const headers = matrix[0].map((value) => value.trim());
  if (headers.join(",") !== officialDeceasedCsvHeaders.join(",")) {
    throw new Error(`Las columnas deben ser exactamente: ${officialDeceasedCsvHeaders.join(", ")}.`);
  }
  if (matrix.length < 2 || matrix.length > MAX_ROWS + 1) {
    throw new Error(`El CSV debe contener entre 1 y ${MAX_ROWS} registros.`);
  }

  const sourceRows = new Set<number>();
  return matrix.slice(1).map((values, rowIndex) => {
    const csvRowNumber = rowIndex + 2;
    if (values.length !== officialDeceasedCsvHeaders.length) {
      throw new Error(`La fila ${csvRowNumber} tiene ${values.length} columnas; se esperaban ${officialDeceasedCsvHeaders.length}.`);
    }
    const raw = Object.fromEntries(
      officialDeceasedCsvHeaders.map((header, index) => [header, values[index].trim()]),
    ) as Record<(typeof officialDeceasedCsvHeaders)[number], string>;

    const sourceRow = parseInteger(raw.source_row, csvRowNumber, "source_row", 1, 1_000_000);
    if (sourceRows.has(sourceRow)) throw new Error(`La fila ${csvRowNumber} repite source_row ${sourceRow}.`);
    sourceRows.add(sourceRow);

    const reportedUnit = requiredText(raw.reported_unit, csvRowNumber, "reported_unit", 120);
    const fullName = requiredText(raw.full_name, csvRowNumber, "full_name", 140);
    if (fullName.length < 3) throw new Error(`La fila ${csvRowNumber} requiere un full_name de al menos 3 caracteres.`);
    const gender = requiredText(raw.gender, csvRowNumber, "gender", 40);
    const approximateAge = raw.approximate_age === ""
      ? null
      : parseInteger(raw.approximate_age, csvRowNumber, "approximate_age", 0, 120);
    if (raw.source_name !== "Medicina Legal") {
      throw new Error(`La fila ${csvRowNumber} debe usar Medicina Legal como source_name.`);
    }
    const sourceReference = requiredText(raw.source_reference, csvRowNumber, "source_reference", 500);
    const publicDescription = requiredText(raw.public_description, csvRowNumber, "public_description", 800);
    const publicLocation = requiredText(
      raw.last_seen_location_public,
      csvRowNumber,
      "last_seen_location_public",
      240,
    );
    if (publicLocation !== reportedUnit) {
      throw new Error(`La fila ${csvRowNumber} debe copiar reported_unit en last_seen_location_public.`);
    }
    if (
      hasObviousContactData(fullName)
      || hasObviousContactData(reportedUnit)
      || hasObviousContactData(publicDescription)
      || hasObviousContactData(publicLocation)
    ) {
      throw new Error(`La fila ${csvRowNumber} contiene contacto en un campo público.`);
    }
    if (raw.date_confirmed && !validIsoDate(raw.date_confirmed)) {
      throw new Error(`La fila ${csvRowNumber} requiere date_confirmed en formato YYYY-MM-DD válido.`);
    }

    return {
      source_row: sourceRow,
      reported_unit: reportedUnit,
      full_name: fullName,
      gender,
      approximate_age: approximateAge,
      source_name: "Medicina Legal",
      source_reference: sourceReference,
      public_description: publicDescription,
      last_seen_location_public: publicLocation,
      date_confirmed: raw.date_confirmed,
    };
  });
}

export function toOfficialDeceasedRpcRows(rows: OfficialDeceasedSourceRow[]): OfficialDeceasedRpcRow[] {
  return rows.map(({ gender: _sourceOnlyGender, ...row }) => row);
}

function requireEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Variable requerida MISSING: ${name}.`);
  return value;
}

export function validateImportEnvironment(environment: NodeJS.ProcessEnv): ImportEnvironment {
  if (environment.CONFIRM_OFFICIAL_IMPORT?.trim() !== CONFIRMATION_VALUE) {
    throw new Error(`Importación cancelada: exige CONFIRM_OFFICIAL_IMPORT=${CONFIRMATION_VALUE}.`);
  }
  const url = requireEnvironment(environment, "NEXT_PUBLIC_SUPABASE_URL");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no es una URL válida.");
  }
  if (parsedUrl.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL debe ser HTTPS y no puede apuntar a localhost.");
  }

  const publishableKey = requireEnvironment(environment, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const accessToken = requireEnvironment(environment, "SUPABASE_ADMIN_ACCESS_TOKEN");
  const reason = requireEnvironment(environment, "OFFICIAL_IMPORT_REASON");
  if (reason.length < 10 || reason.length > 1000) {
    throw new Error("OFFICIAL_IMPORT_REASON debe tener entre 10 y 1000 caracteres.");
  }
  if (/(?:bearer\s+|service[_ -]?role|sb_(?:secret|publishable)_|eyJ[A-Za-z0-9_-]{20,}\.)/iu.test(reason)) {
    throw new Error("OFFICIAL_IMPORT_REASON parece contener una credencial y fue rechazada.");
  }
  return { url, publishableKey, accessToken, reason };
}

function safeRpcFailure(stage: "preview" | "import", error: RpcError): Error {
  const code = typeof error.code === "string" && /^[A-Z0-9]{3,10}$/iu.test(error.code)
    ? error.code
    : "UNKNOWN";
  return new Error(`RPC ${stage} rechazado (code=${code}); no se realizaron logs de filas.`);
}

function aggregatePreview(data: unknown, expectedRows: number): PreviewSummary {
  if (!Array.isArray(data) || data.length !== expectedRows) {
    throw new Error("El RPC preview devolvió una cardinalidad inesperada.");
  }
  const summary: PreviewSummary = {
    total: expectedRows,
    create: 0,
    update: 0,
    alreadyImported: 0,
    reviewRequired: 0,
  };
  for (const item of data) {
    if (!item || typeof item !== "object") throw new Error("El RPC preview devolvió un elemento inválido.");
    const decision = (item as { decision?: unknown }).decision;
    if (decision === "create") summary.create += 1;
    else if (decision === "update") summary.update += 1;
    else if (decision === "already_imported") summary.alreadyImported += 1;
    else if (decision === "review_required") summary.reviewRequired += 1;
    else throw new Error("El RPC preview devolvió una decisión desconocida.");
  }
  return summary;
}

function resultInteger(result: Record<string, unknown>, key: string): number {
  const value = result[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`El RPC import devolvió ${key} inválido.`);
  }
  return value as number;
}

export async function runOfficialDeceasedImport(
  rows: OfficialDeceasedSourceRow[],
  reason: string,
  rpc: OfficialImportRpc,
  onPreview?: (summary: PreviewSummary) => void,
): Promise<ImportSummary> {
  if (!rows.length || rows.length > MAX_ROWS) throw new Error("Cantidad de filas fuera del límite permitido.");
  const payload = toOfficialDeceasedRpcRows(rows);
  const previewResponse = await rpc("preview_official_deceased_import", { p_rows: payload });
  if (previewResponse.error) throw safeRpcFailure("preview", previewResponse.error);
  const preview = aggregatePreview(previewResponse.data, rows.length);
  onPreview?.(preview);
  if (preview.reviewRequired > 0) {
    return {
      status: "blocked",
      total: rows.length,
      created: 0,
      updated: 0,
      alreadyImported: preview.alreadyImported,
      duplicatesBlocked: preview.reviewRequired,
      errors: 0,
    };
  }

  const importResponse = await rpc("import_official_deceased", { p_rows: payload, p_reason: reason });
  if (importResponse.error) throw safeRpcFailure("import", importResponse.error);
  if (!importResponse.data || typeof importResponse.data !== "object" || Array.isArray(importResponse.data)) {
    throw new Error("El RPC import devolvió un resumen inválido.");
  }
  const result = importResponse.data as Record<string, unknown>;
  const total = resultInteger(result, "total");
  if (total !== rows.length) throw new Error("El RPC import devolvió una cardinalidad inesperada.");
  const skipped = result.alreadyImported ?? result.skipped ?? 0;
  const alreadyImported = Number.isSafeInteger(skipped) && (skipped as number) >= 0
    ? skipped as number
    : (() => { throw new Error("El RPC import devolvió alreadyImported inválido."); })();
  return {
    status: "ok",
    total,
    created: resultInteger(result, "created"),
    updated: resultInteger(result, "updated"),
    alreadyImported,
    duplicatesBlocked: 0,
    errors: 0,
  };
}

async function main(): Promise<void> {
  const environment = validateImportEnvironment(process.env);
  const fileArguments = process.argv.slice(2);
  if (fileArguments.length !== 1 || !fileArguments[0]?.trim()) {
    throw new Error("Uso: npm run import:official-deceased -- <archivo.csv>");
  }
  const bytes = await readFile(resolve(fileArguments[0]));
  const rows = parseOfficialDeceasedCsv(decodeOfficialDeceasedCsv(bytes));
  const summary = await runOfficialDeceasedImport(
    rows,
    environment.reason,
    createOfficialImportRpc(environment),
    (preview) => console.log(JSON.stringify({ stage: "preview", ...preview })),
  );
  console.log(JSON.stringify({ stage: "import", ...summary }));
  if (summary.status === "blocked") process.exitCode = 2;
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (invokedAsScript) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({
      status: "error",
      total: 0,
      created: 0,
      updated: 0,
      alreadyImported: 0,
      duplicatesBlocked: 0,
      errors: 1,
      message: error instanceof Error ? error.message : "Error desconocido en importación oficial.",
    }));
    process.exitCode = 1;
  });
}
