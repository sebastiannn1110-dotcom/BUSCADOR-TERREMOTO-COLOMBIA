import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";

const moderationSchema = z.object({
  reportId: z.string().uuid(),
  action: z.enum(["approved", "rejected", "duplicate", "escalated", "request_information"]),
  reason: z.string().trim().min(3).max(1000),
  publicLocation: z.string().trim().max(240).optional(),
  publicDescription: z.string().trim().max(800).optional()
});

export async function GET() {
  const { db, staff } = await getStaffContext();
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503 });
  if (!staff) return NextResponse.json({ message: "Acceso no autorizado." }, { status: 401 });
  const { data, error } = await db.rpc("get_pending_case_reports");
  if (error) {
    console.error("[ADMIN SIGHTINGS] rpc(\"get_pending_case_reports\") failed", error);
    return NextResponse.json({ message: error.message, code: error.code, details: error.details, hint: error.hint }, { status: 500 });
  }
  return NextResponse.json({ reports: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { db, staff } = await getStaffContext();
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503 });
  if (!staff) return NextResponse.json({ message: "Acceso no autorizado." }, { status: 401 });
  const parsed = moderationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Revisa la acción y su justificación.", issues: parsed.error.flatten() }, { status: 400 });
  const { reportId, action, reason, publicLocation, publicDescription } = parsed.data;
  console.info("[ADMIN SIGHTINGS] Executing rpc(\"moderate_case_report\")", { reportId, action, actorId: staff.id });
  const { data, error } = await db.rpc("moderate_case_report", {
    p_report_id: reportId,
    p_action: action,
    p_reason: reason,
    p_public_location: publicLocation || null,
    p_public_description: publicDescription || null
  });
  if (error) {
    console.error("[ADMIN SIGHTINGS] rpc(\"moderate_case_report\") failed", error);
    return NextResponse.json({ message: error.message, code: error.code, details: error.details, hint: error.hint }, { status: error.code === "42501" ? 403 : 500 });
  }
  return NextResponse.json({ result: data });
}
