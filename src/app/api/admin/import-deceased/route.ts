import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseOfficialCsv } from "@/lib/official-import";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";

const requestSchema = z.object({
  csv: z.string().min(1).max(512 * 1024),
  mode: z.enum(["preview", "confirm"]),
  reason: z.string().max(1000).optional()
});

export async function POST(request: NextRequest) {
  const { db, staff } = await getStaffContext("admin");
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503 });
  if (!staff) return NextResponse.json({ message: "Solo un administrador activo puede importar fallecimientos oficiales." }, { status: 403 });
  const parsedRequest = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsedRequest.success) return NextResponse.json({ message: "La solicitud de importación no es válida." }, { status: 400 });

  let rows;
  try {
    rows = parseOfficialCsv(parsedRequest.data.csv);
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "El CSV no es válido." }, { status: 400 });
  }

  if (parsedRequest.data.mode === "preview") {
    console.info("[OFFICIAL IMPORT] Executing rpc(\"preview_official_deceased_import\")", { actorId: staff.id, rowCount: rows.length });
    const { data, error } = await db.rpc("preview_official_deceased_import", { p_rows: rows });
    if (error) {
      console.error("[OFFICIAL IMPORT] preview RPC failed", error);
      return NextResponse.json({ message: error.message, code: error.code, details: error.details, hint: error.hint }, { status: 500 });
    }
    return NextResponse.json({ rows, preview: data });
  }

  const reason = parsedRequest.data.reason?.trim() || "";
  if (reason.length < 10) return NextResponse.json({ message: "La confirmación requiere una justificación de al menos 10 caracteres." }, { status: 400 });
  console.info("[OFFICIAL IMPORT] Executing rpc(\"import_official_deceased\")", { actorId: staff.id, rowCount: rows.length });
  const { data, error } = await db.rpc("import_official_deceased", { p_rows: rows, p_reason: reason });
  if (error) {
    console.error("[OFFICIAL IMPORT] import RPC failed", error);
    return NextResponse.json({ message: error.message, code: error.code, details: error.details, hint: error.hint }, { status: error.code === "42501" ? 403 : 500 });
  }
  return NextResponse.json({ result: data });
}
