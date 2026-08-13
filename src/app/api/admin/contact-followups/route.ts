import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

const nullableUuid = z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  z.string().uuid().nullable()
);
const nullableDateTime = z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  z.string().datetime({ offset: true }).nullable()
);

const followupSchema = z.object({
  caseId: z.string().uuid(),
  reportId: nullableUuid,
  contactId: nullableUuid,
  targetType: z.enum(["reportante_inicial", "informante", "familia", "otro"]),
  contactMethod: z.enum(["llamada", "whatsapp", "sms", "correo", "presencial", "otro"]),
  contactStatus: z.enum(["pendiente", "contactado", "no_respondio", "numero_errado", "requiere_seguimiento", "cerrado"]),
  summaryPrivate: z.string().trim().min(3).max(2000),
  nextFollowupAt: nullableDateTime
}).superRefine((value, context) => {
  if (value.contactStatus === "requiere_seguimiento" && !value.nextFollowupAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["nextFollowupAt"], message: "Indica la fecha del próximo seguimiento." });
  }
});

export async function GET() {
  const { db, staff } = await getStaffContext();
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503, headers: privateHeaders });
  if (!staff) return NextResponse.json({ message: "Acceso no autorizado." }, { status: 401, headers: privateHeaders });

  const { data, error } = await db.rpc("get_contact_followup_queue");
  if (error) {
    console.error("[ADMIN CONTACT FOLLOWUPS] queue RPC failed", { code: error.code });
    return NextResponse.json(
      { message: "No fue posible cargar la cola de seguimientos.", code: error.code },
      { status: error.code === "42501" ? 403 : 500, headers: privateHeaders }
    );
  }
  return NextResponse.json({ items: Array.isArray(data) ? data : [] }, { headers: privateHeaders });
}

export async function POST(request: NextRequest) {
  const { db, staff } = await getStaffContext("moderator_or_admin");
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503, headers: privateHeaders });
  if (!staff) return NextResponse.json({ message: "Acceso no autorizado." }, { status: 401, headers: privateHeaders });

  const parsed = followupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Revisa los datos del seguimiento de contacto.", issues: parsed.error.flatten() }, { status: 400, headers: privateHeaders });
  }
  const values = parsed.data;
  console.info("[ADMIN CONTACT FOLLOWUPS] Executing follow-up RPC", { actorId: staff.id, caseId: values.caseId, status: values.contactStatus });
  const { data, error } = await db.rpc("log_contact_followup", {
    p_case_id: values.caseId,
    p_report_id: values.reportId,
    p_contact_id: values.contactId,
    p_target_type: values.targetType,
    p_contact_method: values.contactMethod,
    p_contact_status: values.contactStatus,
    p_summary_private: values.summaryPrivate,
    p_next_followup_at: values.nextFollowupAt
  });
  if (error) {
    console.error("[ADMIN CONTACT FOLLOWUPS] follow-up RPC failed", { code: error.code, caseId: values.caseId });
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "22023" ? 400 : 500;
    return NextResponse.json(
      { message: "No fue posible guardar el seguimiento de contacto.", code: error.code },
      { status, headers: privateHeaders }
    );
  }
  return NextResponse.json({ result: data }, { headers: privateHeaders });
}
