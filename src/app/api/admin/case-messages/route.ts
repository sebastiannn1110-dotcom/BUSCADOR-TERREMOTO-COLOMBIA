import { NextResponse } from "next/server";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  const { db, staff } = await getStaffContext();
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503, headers: privateHeaders });
  if (!staff) return NextResponse.json({ message: "Acceso no autorizado." }, { status: 403, headers: privateHeaders });

  const { data, error } = await db.rpc("get_admin_case_message_threads", { p_limit: 100 });
  if (error) {
    console.error("[ADMIN CASE MESSAGES] inbox RPC failed", { code: error.code });
    return NextResponse.json(
      { message: "No fue posible cargar la bandeja privada de mensajes.", code: error.code },
      { status: error.code === "42501" ? 403 : 500, headers: privateHeaders }
    );
  }
  return NextResponse.json({ threads: Array.isArray(data) ? data : [] }, { headers: privateHeaders });
}
