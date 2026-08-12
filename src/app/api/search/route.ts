import { NextRequest, NextResponse } from "next/server";
import { searchCases } from "@/lib/cases";
export async function GET(request: NextRequest) { try { const p = request.nextUrl.searchParams; const results = await searchCases(p.get("q") || "", { status: p.get("status") || "", minAge: p.get("minAge") || "", maxAge: p.get("maxAge") || "" }); return NextResponse.json({ results }); } catch { return NextResponse.json({ message: "No pudimos realizar la búsqueda. Inténtalo nuevamente." }, { status: 503 }); } }
