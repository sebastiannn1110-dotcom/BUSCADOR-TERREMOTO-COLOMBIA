import { readSheet, type CellValue, type SheetData } from "read-excel-file/node";
import { hasObviousContactData } from "@/lib/request-security";

export type PersonImportType = "missing" | "deceased";

export const missingImportHeaders = [
  "source_row",
  "full_name",
  "department_disappearance",
  "municipality_disappearance",
  "source_name",
  "source_reference",
  "public_description"
] as const;

export const deceasedImportHeaders = [
  "source_row",
  "reported_unit",
  "full_name",
  "gender",
  "approximate_age",
  "source_name",
  "source_reference",
  "public_description",
  "last_seen_location_public",
  "date_confirmed"
] as const;

export type MissingImportRow = Record<(typeof missingImportHeaders)[number], string>;
export type DeceasedImportRow = Record<(typeof deceasedImportHeaders)[number], string>;
export type PersonImportRow = MissingImportRow | DeceasedImportRow;

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 500;

const missingAliases: Record<string, (typeof missingImportHeaders)[number]> = {
  source_row: "source_row",
  n: "source_row",
  no: "source_row",
  numero: "source_row",
  nombres: "full_name",
  nombre: "full_name",
  full_name: "full_name",
  departamento_desaparicion: "department_disappearance",
  department_disappearance: "department_disappearance",
  municipio_desaparicion: "municipality_disappearance",
  municipality_disappearance: "municipality_disappearance",
  source_name: "source_name",
  fuente: "source_name",
  source_reference: "source_reference",
  referencia: "source_reference",
  public_description: "public_description",
  descripcion_publica: "public_description"
};

const deceasedAliases: Record<string, (typeof deceasedImportHeaders)[number]> = {
  source_row: "source_row",
  n: "source_row",
  no: "source_row",
  numero: "source_row",
  reported_unit: "reported_unit",
  unidad_basica: "reported_unit",
  full_name: "full_name",
  nombres: "full_name",
  nombre: "full_name",
  gender: "gender",
  genero: "gender",
  sexo: "gender",
  approximate_age: "approximate_age",
  edad: "approximate_age",
  source_name: "source_name",
  fuente: "source_name",
  source_reference: "source_reference",
  referencia: "source_reference",
  public_description: "public_description",
  descripcion_publica: "public_description",
  last_seen_location_public: "last_seen_location_public",
  lugar_reportado: "last_seen_location_public",
  date_confirmed: "date_confirmed",
  fecha_confirmacion: "date_confirmed"
};

function normalizedHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[°º#]/gu, "")
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function cellText(value: CellValue | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

function delimiterFor(firstLine: string) {
  const counts = ["\t", ",", ";"].map((delimiter) => ({
    delimiter,
    count: firstLine.split(delimiter).length - 1
  }));
  return counts.sort((a, b) => b.count - a.count)[0]?.delimiter || ",";
}

export function parseDelimitedMatrix(input: string): string[][] {
  const source = input.replace(/^\uFEFF/u, "");
  const delimiter = delimiterFor(source.split(/\r?\n/u, 1)[0] || "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field.trim());
      field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += character;
  }
  if (quoted) throw new Error("La tabla contiene una comilla sin cerrar.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function validateDate(value: string, rowNumber: number) {
  if (!value) return;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`La fila ${rowNumber} requiere date_confirmed en formato YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`La fila ${rowNumber} contiene una fecha imposible.`);
  }
}

function mappedRows(matrix: string[][], type: PersonImportType): PersonImportRow[] {
  if (!matrix.length) throw new Error("El archivo o la tabla están vacíos.");
  if (matrix.length < 2 || matrix.length > MAX_ROWS + 1) {
    throw new Error(`La importación debe contener entre 1 y ${MAX_ROWS} registros.`);
  }
  const aliases = type === "missing" ? missingAliases : deceasedAliases;
  const headers = type === "missing" ? missingImportHeaders : deceasedImportHeaders;
  const mappedHeaders = matrix[0].map((value) => aliases[normalizedHeader(value)] || null);
  if (!mappedHeaders.includes("full_name")) {
    throw new Error("No se encontró la columna obligatoria full_name o Nombres.");
  }
  const duplicates = mappedHeaders.filter((header, index) => header && mappedHeaders.indexOf(header) !== index);
  if (duplicates.length) throw new Error(`Hay una columna repetida: ${duplicates[0]}.`);

  return matrix.slice(1).map((values, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const output = Object.fromEntries(headers.map((header) => [header, ""])) as unknown as PersonImportRow;
    mappedHeaders.forEach((header, columnIndex) => {
      if (header) output[header as keyof PersonImportRow] = (values[columnIndex] || "").trim();
    });
    const name = output.full_name.trim();
    if (name.length < 3 || name.length > 140) {
      throw new Error(`La fila ${rowNumber} requiere full_name entre 3 y 140 caracteres.`);
    }
    if (hasObviousContactData(name)) {
      throw new Error(`La fila ${rowNumber} contiene contacto en el nombre público.`);
    }

    if (type === "missing") {
      const missing = output as MissingImportRow;
      if (missing.department_disappearance.length > 120 || missing.municipality_disappearance.length > 120) {
        throw new Error(`La fila ${rowNumber} contiene un lugar demasiado largo.`);
      }
      if (missing.source_name.length > 160 || missing.source_reference.length > 500 || missing.public_description.length > 800) {
        throw new Error(`La fila ${rowNumber} supera el límite de un campo.`);
      }
      if ([missing.department_disappearance, missing.municipality_disappearance, missing.public_description]
        .some((value) => value && hasObviousContactData(value))) {
        throw new Error(`La fila ${rowNumber} contiene teléfono o correo en un campo público.`);
      }
    } else {
      const deceased = output as DeceasedImportRow;
      if (deceased.source_name && deceased.source_name.toLocaleLowerCase("es") !== "medicina legal") {
        throw new Error(`La fila ${rowNumber} debe usar Medicina Legal como source_name.`);
      }
      if (deceased.source_reference.length > 500) {
        throw new Error(`La fila ${rowNumber} supera el límite de source_reference.`);
      }
      if (deceased.reported_unit.length > 120 || deceased.gender.length > 40
        || deceased.public_description.length > 800 || deceased.last_seen_location_public.length > 240) {
        throw new Error(`La fila ${rowNumber} supera el límite de un campo.`);
      }
      if (deceased.approximate_age && (!/^\d{1,3}$/u.test(deceased.approximate_age)
        || Number(deceased.approximate_age) > 120)) {
        throw new Error(`La fila ${rowNumber} contiene una edad inválida.`);
      }
      validateDate(deceased.date_confirmed, rowNumber);
      if ([deceased.reported_unit, deceased.public_description, deceased.last_seen_location_public]
        .some((value) => value && hasObviousContactData(value))) {
        throw new Error(`La fila ${rowNumber} contiene teléfono o correo en un campo público.`);
      }
    }
    return output;
  });
}

export function parsePersonImportText(input: string, type: PersonImportType) {
  if (new TextEncoder().encode(input).byteLength > MAX_FILE_BYTES) {
    throw new Error("El archivo supera el límite de 5 MB.");
  }
  return mappedRows(parseDelimitedMatrix(input), type);
}

export async function parsePersonImportFile(file: File, type: PersonImportType) {
  if (file.size < 1 || file.size > MAX_FILE_BYTES) {
    throw new Error("El archivo debe pesar entre 1 byte y 5 MB.");
  }
  const extension = file.name.toLocaleLowerCase("es").split(".").pop();
  if (extension !== "csv" && extension !== "xlsx") {
    throw new Error("Solo se aceptan archivos .csv y .xlsx.");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (extension === "csv") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("El CSV debe estar codificado en UTF-8.");
    }
    return parsePersonImportText(text, type);
  }
  let sheet: SheetData;
  try {
    sheet = await readSheet(bytes, 1);
  } catch {
    throw new Error("No fue posible leer el archivo XLSX. Verifica que sea un libro de Excel válido.");
  }
  return mappedRows(sheet.map((row) => row.map(cellText)), type);
}

export function applyImportDefaults(
  rows: PersonImportRow[],
  type: PersonImportType,
  defaults: { sourceName: string; sourceReference: string; publicDescription: string }
) {
  return rows.map((row) => ({
    ...row,
    source_name: row.source_name || defaults.sourceName,
    source_reference: row.source_reference || defaults.sourceReference,
    public_description: row.public_description || defaults.publicDescription,
    ...(type === "deceased" ? { source_name: "Medicina Legal" } : {})
  })) as PersonImportRow[];
}
