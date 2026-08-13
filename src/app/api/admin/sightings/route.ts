import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStaffContext } from "@/lib/supabase/auth-server";
import { hasObviousContactData } from "@/lib/request-security";

export const runtime = "nodejs";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

const moderationSchema = z.object({
  reportId: z.string().uuid(),
  action: z.enum(["approved", "rejected", "duplicate", "escalated", "request_information"]),
  reason: z.string().trim().min(3).max(1000),
  publicLocation: z.string().trim().max(240).optional(),
  publicDescription: z.string().trim().max(800).optional()
});

export async function GET() {
  const { db, staff } = await getStaffContext();
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503, headers: privateHeaders });
  if (!staff) return NextResponse.json({ message: "Acceso no autorizado." }, { status: 401, headers: privateHeaders });
  const { data, error } = await db.rpc("get_pending_case_reports");
  if (error) {
    console.error("[ADMIN SIGHTINGS] rpc(\"get_pending_case_reports\") failed", { code: error.code });
    return NextResponse.json({ message: "No fue posible cargar los reportes pendientes.", code: error.code }, { status: 500, headers: privateHeaders });
  }
  return NextResponse.json({ reports: data ?? [] }, { headers: privateHeaders });
}

export async function POST(request: NextRequest) {
  const { db, staff } = await getStaffContext("moderator_or_admin");
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503, headers: privateHeaders });
  if (!staff) return NextResponse.json({ message: "Acceso no autorizado." }, { status: 401, headers: privateHeaders });
  const parsed = moderationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Revisa la acción y su justificación.", issues: parsed.error.flatten() }, { status: 400, headers: privateHeaders });
  const { reportId, action, reason, publicLocation, publicDescription } = parsed.data;
  if (action === "approved" && [publicLocation, publicDescription].some((value) => value && hasObviousContactData(value))) {
    return NextResponse.json({ message: "Los campos públicos no pueden contener teléfonos ni correos." }, { status: 400, headers: privateHeaders });
  }
  console.info("[ADMIN SIGHTINGS] Executing rpc(\"moderate_case_report\")", { reportId, action, actorId: staff.id });
  const { data, error } = await db.rpc("moderate_case_report", {
    p_report_id: reportId,
    p_action: action,
    p_reason: reason,
    p_public_location: publicLocation || null,
    p_public_description: publicDescription || null
  });
  if (error) {
    console.error("[ADMIN SIGHTINGS] rpc(\"moderate_case_report\") failed", { code: error.code, reportId, action });
    return NextResponse.json({ message: "No fue posible guardar la moderación del reporte.", code: error.code }, { status: error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500, headers: privateHeaders });
  }
  return NextResponse.json({ result: data }, { headers: privateHeaders });
}
