import { NextResponse } from "next/server";
import { hasSupabase } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export function GET() { return NextResponse.json({ status: "ok", service: "encontrarnos", databaseConfigured: hasSupabase() }); }
