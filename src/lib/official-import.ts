import { z } from "zod";

export const officialImportHeaders = [
  "full_name",
  "approximate_age",
  "gender",
  "source_name",
  "source_reference",
  "public_description",
  "last_seen_location_public",
  "date_confirmed"
] as const;

export type OfficialImportRow = Record<(typeof officialImportHeaders)[number], string>;

const rowSchema = z.object({
  full_name: z.string().trim().min(3).max(140),
  approximate_age: z.union([z.literal(""), z.string().regex(/^\d{1,3}$/).refine((value) => Number(value) <= 120, "La edad debe estar entre 0 y 120.")]),
  gender: z.string().trim().max(80),
  source_name: z.string().trim().refine((value) => value.toLocaleLowerCase("es") === "medicina legal", "La fuente debe ser Medicina Legal."),
  source_reference: z.string().trim().max(500),
  date_confirmed: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  last_seen_location_public: z.string().trim().max(240),
  public_description: z.string().trim().max(800)
});

function parseCsvMatrix(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error("El CSV contiene una comilla sin cerrar.");
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function parseOfficialCsv(csv: string): OfficialImportRow[] {
  if (new TextEncoder().encode(csv).byteLength > 512 * 1024) throw new Error("El CSV supera el límite de 512 KB.");
  const matrix = parseCsvMatrix(csv.replace(/^\uFEFF/, ""));
  if (!matrix.length) throw new Error("El CSV está vacío.");
  const headers = matrix[0].map((value) => value.trim());
  if (headers.join(",") !== officialImportHeaders.join(",")) throw new Error(`Las columnas deben ser exactamente: ${officialImportHeaders.join(", ")}.`);
  if (matrix.length < 2 || matrix.length > 501) throw new Error("El CSV debe contener entre 1 y 500 registros.");

  return matrix.slice(1).map((values, rowIndex) => {
    if (values.length !== officialImportHeaders.length) throw new Error(`La fila ${rowIndex + 2} tiene ${values.length} columnas; se esperaban ${officialImportHeaders.length}.`);
    const candidate = Object.fromEntries(officialImportHeaders.map((header, index) => [header, values[index].trim()]));
    const parsed = rowSchema.safeParse(candidate);
    if (!parsed.success) throw new Error(`La fila ${rowIndex + 2} no es válida: ${parsed.error.issues[0]?.message || "revisa sus valores"}`);
    return parsed.data as OfficialImportRow;
  });
}
