import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStaffContext } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

const withdrawSchema = z.object({
  caseId: z.string().uuid(),
  reason: z.string().trim().min(3).max(1000)
});

function errorStatus(code: string | undefined) {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "22023" || code === "P0001") return 400;
  return 500;
}

export async function GET(request: NextRequest) {
  const { db, staff } = await getStaffContext("moderator_or_admin");
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503, headers: privateHeaders });
  if (!staff) return NextResponse.json({ message: "Acceso no autorizado." }, { status: 403, headers: privateHeaders });

  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  if (query.length > 140) {
    return NextResponse.json({ message: "La búsqueda es demasiado larga." }, { status: 400, headers: privateHeaders });
  }
  const { data, error } = await db.rpc("get_admin_people_cases", {
    p_query: query,
    p_limit: 200,
    p_offset: 0
  });
  if (error) {
    console.error("[ADMIN PEOPLE] list RPC failed", { code: error.code });
    return NextResponse.json(
      { message: "No fue posible cargar las personas administradas.", code: error.code },
      { status: errorStatus(error.code), headers: privateHeaders }
    );
  }
  return NextResponse.json({ people: Array.isArray(data) ? data : [] }, { headers: privateHeaders });
}

export async function POST(request: NextRequest) {
  const { db, staff } = await getStaffContext("admin");
  if (!db) return NextResponse.json({ message: "Supabase Auth no está configurado." }, { status: 503, headers: privateHeaders });
  if (!staff) return NextResponse.json({ message: "Solo un administrador puede retirar una persona publicada." }, { status: 403, headers: privateHeaders });

  const parsed = withdrawSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Indica el caso y una razón válida para retirarlo." }, { status: 400, headers: privateHeaders });
  }

  console.info("[ADMIN PEOPLE] Executing audited withdrawal RPC", { actorId: staff.id, caseId: parsed.data.caseId });
  const { data, error } = await db.rpc("withdraw_person_case", {
    p_case_id: parsed.data.caseId,
    p_reason: parsed.data.reason
  });
  if (error) {
    console.error("[ADMIN PEOPLE] withdrawal RPC failed", { code: error.code, caseId: parsed.data.caseId });
    return NextResponse.json(
      { message: "No fue posible retirar la persona del buscador.", code: error.code },
      { status: errorStatus(error.code), headers: privateHeaders }
    );
  }
  return NextResponse.json({ result: data }, { headers: privateHeaders });
}
