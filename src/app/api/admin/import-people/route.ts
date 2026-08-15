import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  applyImportDefaults,
  parsePersonImportFile,
  parsePersonImportText,
  type PersonImportRow,
  type PersonImportType
} from "@/lib/person-import";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

const fieldsSchema = z.object({
  importType: z.enum(["missing", "deceased"]),
  verificationLevel: z.enum(["moderator_reviewed", "authority_confirmed"]),
  sourceName: z.string().trim().min(2).max(160),
  sourceReference: z.string().trim().min(2).max(500),
  defaultPublicDescription: z.string().trim().max(800),
  mode: z.enum(["preview", "confirm"]),
  reason: z.string().max(1000),
  confirmedOfficialSource: z.enum(["true", "false"]),
  previewToken: z.string().max(2048)
});

type PreviewTokenPayload = {
  actorId: string;
  importType: PersonImportType;
  verificationLevel: string;
  rowsHash: string;
  expiresAt: number;
};

function errorStatus(code: string | undefined) {
  if (code === "42501") return 403;
  if (code === "22023") return 400;
  if (code === "P0003" || code === "23505") return 409;
  return 500;
}

function signingSecret() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
}

function hashRows(rows: PersonImportRow[]) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("base64url");
}

function createPreviewToken(
  actorId: string,
  importType: PersonImportType,
  verificationLevel: string,
  rows: PersonImportRow[],
  secret: string
) {
  const payload: PreviewTokenPayload = {
    actorId,
    importType,
    verificationLevel,
    rowsHash: hashRows(rows),
    expiresAt: Date.now() + 15 * 60 * 1000
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function validPreviewToken(
  token: string,
  actorId: string,
  importType: PersonImportType,
  verificationLevel: string,
  rows: PersonImportRow[],
  secret: string
) {
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) return false;
  const expected = createHmac("sha256", secret).update(encoded).digest();
  try {
    const received = Buffer.from(suppliedSignature, "base64url");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PreviewTokenPayload;
    return received.length === expected.length
      && timingSafeEqual(received, expected)
      && payload.actorId === actorId
      && payload.importType === importType
      && payload.verificationLevel === verificationLevel
      && payload.rowsHash === hashRows(rows)
      && Number.isFinite(payload.expiresAt)
      && payload.expiresAt >= Date.now();
  } catch {
    return false;
  }
}

function hasBlockedRows(value: unknown) {
  return Array.isArray(value) && value.some((item) => !item || typeof item !== "object"
    || (item as { decision?: unknown }).decision === "review_required");
}

function stringField(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function parsedRows(form: FormData, type: PersonImportType) {
  const fileValue = form.get("file");
  const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
  const pastedText = stringField(form, "pastedText").trim();
  if (file && pastedText) throw new Error("Usa un archivo o una tabla pegada, no ambos al mismo tiempo.");
  if (!file && !pastedText) throw new Error("Selecciona un archivo o pega una tabla.");
  return file ? parsePersonImportFile(file, type) : parsePersonImportText(pastedText, type);
}

export async function POST(request: NextRequest) {
  const { db, staff } = await getStaffContext("admin");
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503, headers: privateHeaders });
  if (!staff) return NextResponse.json({ message: "Solo un administrador activo puede importar personas." }, { status: 403, headers: privateHeaders });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ message: "La solicitud multipart no es válida." }, { status: 400, headers: privateHeaders });
  }
  const fields = fieldsSchema.safeParse({
    importType: stringField(form, "importType"),
    verificationLevel: stringField(form, "verificationLevel"),
    sourceName: stringField(form, "sourceName"),
    sourceReference: stringField(form, "sourceReference"),
    defaultPublicDescription: stringField(form, "defaultPublicDescription"),
    mode: stringField(form, "mode"),
    reason: stringField(form, "reason"),
    confirmedOfficialSource: stringField(form, "confirmedOfficialSource") || "false",
    previewToken: stringField(form, "previewToken")
  });
  if (!fields.success) {
    return NextResponse.json({ message: "Revisa el tipo, la fuente y los campos de importación." }, { status: 400, headers: privateHeaders });
  }

  const type = fields.data.importType;
  const verificationLevel = type === "deceased" ? "authority_confirmed" : fields.data.verificationLevel;
  if (type === "deceased" && fields.data.sourceName.toLocaleLowerCase("es") !== "medicina legal") {
    return NextResponse.json({ message: "Los fallecidos confirmados deben usar Medicina Legal como fuente." }, { status: 400, headers: privateHeaders });
  }

  let rows: PersonImportRow[];
  try {
    rows = applyImportDefaults(await parsedRows(form, type), type, {
      sourceName: fields.data.sourceName,
      sourceReference: fields.data.sourceReference,
      publicDescription: fields.data.defaultPublicDescription
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "No fue posible leer el archivo." }, { status: 400, headers: privateHeaders });
  }
  if (rows.some((row) => !row.source_name.trim() || !row.source_reference.trim())) {
    return NextResponse.json({ message: "Cada fila requiere source_name y source_reference, ya sea en el archivo o en los valores generales." }, { status: 400, headers: privateHeaders });
  }

  const secret = signingSecret();
  if (!secret) return NextResponse.json({ message: "La importación no está configurada en el servidor." }, { status: 503, headers: privateHeaders });
  const previewRpc = type === "missing" ? "preview_missing_people_import" : "preview_official_deceased_import";
  const previewArguments = type === "missing"
    ? { p_rows: rows, p_verification_level: verificationLevel }
    : { p_rows: rows };

  if (fields.data.mode === "preview") {
    console.info("[PERSON IMPORT] Generating preview", { importType: type, rowCount: rows.length });
    const { data, error } = await db.rpc(previewRpc, previewArguments);
    if (error) {
      console.error("[PERSON IMPORT] Preview failed", { code: error.code, importType: type });
      return NextResponse.json({ message: "No fue posible generar la vista previa.", code: error.code }, { status: errorStatus(error.code), headers: privateHeaders });
    }
    return NextResponse.json({
      preview: data,
      previewToken: createPreviewToken(staff.id, type, verificationLevel, rows, secret)
    }, { headers: privateHeaders });
  }

  const reason = fields.data.reason.trim();
  if (reason.length < 10) {
    return NextResponse.json({ message: "La confirmación requiere una razón de al menos 10 caracteres." }, { status: 400, headers: privateHeaders });
  }
  const official = fields.data.confirmedOfficialSource === "true";
  if ((type === "deceased" || verificationLevel === "authority_confirmed") && !official) {
    return NextResponse.json({ message: "Debes confirmar que revisaste la lista contra una fuente oficial." }, { status: 400, headers: privateHeaders });
  }
  if (!validPreviewToken(fields.data.previewToken, staff.id, type, verificationLevel, rows, secret)) {
    return NextResponse.json({ message: "La vista previa venció o el archivo cambió. Genera una nueva." }, { status: 409, headers: privateHeaders });
  }

  const { data: currentPreview, error: previewError } = await db.rpc(previewRpc, previewArguments);
  if (previewError) {
    return NextResponse.json({ message: "No fue posible verificar nuevamente la vista previa.", code: previewError.code }, { status: errorStatus(previewError.code), headers: privateHeaders });
  }
  if (hasBlockedRows(currentPreview)) {
    return NextResponse.json({ message: "Hay homónimos o filas ambiguas. Deben resolverse manualmente antes de importar." }, { status: 409, headers: privateHeaders });
  }

  const importRpc = type === "missing" ? "import_missing_people" : "import_official_deceased_v2";
  const importArguments = type === "missing"
    ? { p_rows: rows, p_verification_level: verificationLevel, p_confirmed_official: official, p_reason: reason }
    : { p_rows: rows, p_reason: reason };
  console.info("[PERSON IMPORT] Confirming audited import", { importType: type, rowCount: rows.length });
  const { data, error } = await db.rpc(importRpc, importArguments);
  if (error) {
    console.error("[PERSON IMPORT] Import failed", { code: error.code, importType: type });
    return NextResponse.json({ message: "No fue posible completar la importación.", code: error.code }, { status: errorStatus(error.code), headers: privateHeaders });
  }
  return NextResponse.json({ result: data }, { headers: privateHeaders });
}
