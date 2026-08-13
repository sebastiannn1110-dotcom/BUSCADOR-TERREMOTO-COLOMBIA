import { NextRequest, NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { parseOfficialCsv, type OfficialImportRow } from "@/lib/official-import";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

const requestSchema = z.object({
  csv: z.string().min(1).max(512 * 1024),
  mode: z.enum(["preview", "confirm"]),
  reason: z.string().max(1000).optional(),
  confirmedOfficialSource: z.boolean().optional(),
  previewToken: z.string().max(2048).optional()
});

type PreviewTokenPayload = { actorId: string; rowsHash: string; expiresAt: number };

function signingSecret() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
}

function rowsHash(rows: OfficialImportRow[]) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("base64url");
}

function createPreviewToken(actorId: string, rows: OfficialImportRow[], secret: string) {
  const payload: PreviewTokenPayload = { actorId, rowsHash: rowsHash(rows), expiresAt: Date.now() + 15 * 60 * 1000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function validPreviewToken(token: string | undefined, actorId: string, rows: OfficialImportRow[], secret: string) {
  if (!token) return false;
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) return false;
  const expectedSignature = createHmac("sha256", secret).update(encoded).digest();
  let receivedSignature: Buffer;
  let payload: PreviewTokenPayload;
  try {
    receivedSignature = Buffer.from(suppliedSignature, "base64url");
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PreviewTokenPayload;
  } catch {
    return false;
  }
  return receivedSignature.length === expectedSignature.length
    && timingSafeEqual(receivedSignature, expectedSignature)
    && payload.actorId === actorId
    && payload.rowsHash === rowsHash(rows)
    && Number.isFinite(payload.expiresAt)
    && payload.expiresAt >= Date.now();
}

function hasBlockedMatches(value: unknown) {
  return Array.isArray(value) && value.some((item) => {
    if (!item || typeof item !== "object") return true;
    return (item as { decision?: unknown }).decision === "review_required";
  });
}

export async function POST(request: NextRequest) {
  const { db, staff } = await getStaffContext("admin");
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503, headers: privateHeaders });
  if (!staff) return NextResponse.json({ message: "Solo un administrador activo puede importar fallecimientos oficiales." }, { status: 403, headers: privateHeaders });
  const parsedRequest = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsedRequest.success) return NextResponse.json({ message: "La solicitud de importación no es válida." }, { status: 400, headers: privateHeaders });

  let rows;
  try {
    rows = parseOfficialCsv(parsedRequest.data.csv);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "El CSV no es válido." }, { status: 400, headers: privateHeaders });
  }

  const secret = signingSecret();
  if (!secret) return NextResponse.json({ message: "La importación oficial no está configurada en el servidor." }, { status: 503, headers: privateHeaders });

  if (parsedRequest.data.mode === "preview") {
    console.info("[OFFICIAL IMPORT] Executing rpc(\"preview_official_deceased_import\")", { actorId: staff.id, rowCount: rows.length });
    const { data, error } = await db.rpc("preview_official_deceased_import", { p_rows: rows });
    if (error) {
      console.error("[OFFICIAL IMPORT] preview RPC failed", { code: error.code });
      const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500;
      return NextResponse.json({ message: "No fue posible generar la vista previa oficial.", code: error.code }, { status, headers: privateHeaders });
    }
    return NextResponse.json(
      { preview: data, previewToken: createPreviewToken(staff.id, rows, secret) },
      { headers: privateHeaders }
    );
  }

  const reason = parsedRequest.data.reason?.trim() || "";
  if (reason.length < 10) return NextResponse.json({ message: "La confirmación requiere una justificación de al menos 10 caracteres." }, { status: 400, headers: privateHeaders });
  if (parsedRequest.data.confirmedOfficialSource !== true) {
    return NextResponse.json({ message: "Debes confirmar que revisaste la información contra una fuente oficial." }, { status: 400, headers: privateHeaders });
  }
  if (!validPreviewToken(parsedRequest.data.previewToken, staff.id, rows, secret)) {
    return NextResponse.json({ message: "La vista previa venció o el CSV cambió. Genera una vista previa nueva antes de confirmar." }, { status: 409, headers: privateHeaders });
  }

  const { data: currentPreview, error: previewError } = await db.rpc("preview_official_deceased_import", { p_rows: rows });
  if (previewError) {
    console.error("[OFFICIAL IMPORT] confirmation preview RPC failed", { code: previewError.code });
    return NextResponse.json({ message: "No fue posible verificar nuevamente la vista previa oficial.", code: previewError.code }, { status: 500, headers: privateHeaders });
  }
  if (hasBlockedMatches(currentPreview)) {
    return NextResponse.json({ message: "Hay coincidencias ambiguas. Cada fila debe revisarse manualmente antes de importar." }, { status: 409, headers: privateHeaders });
  }

  console.info("[OFFICIAL IMPORT] Executing rpc(\"import_official_deceased\")", { actorId: staff.id, rowCount: rows.length });
  const { data, error } = await db.rpc("import_official_deceased", { p_rows: rows, p_reason: reason });
  if (error) {
    console.error("[OFFICIAL IMPORT] import RPC failed", { code: error.code });
    return NextResponse.json({ message: "No fue posible completar la importación oficial.", code: error.code }, { status: error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500, headers: privateHeaders });
  }
  return NextResponse.json({ result: data }, { headers: privateHeaders });
}
