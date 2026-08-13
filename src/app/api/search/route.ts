import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_CASE_PAGE_SIZE, sanitizePublicCase, searchCases } from "@/lib/cases";
import type { CaseCard } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const parameters = request.nextUrl.searchParams;
    const requestedPage = Number(parameters.get("pagina") || 1);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10_000) : 1;
    const results = await searchCases(parameters.get("q") || "", {
      status: parameters.get("estado") || parameters.get("status") || "",
      minAge: parameters.get("minAge") || "",
      maxAge: parameters.get("maxAge") || "",
      page: String(page)
    });
    const safeResults = results.map(sanitizePublicCase).filter((item): item is CaseCard => item !== null);
    return NextResponse.json({ results: safeResults, page, hasMore: results.length === PUBLIC_CASE_PAGE_SIZE });
  } catch {
    return NextResponse.json({ message: "No pudimos realizar la búsqueda. Inténtalo nuevamente." }, { status: 503 });
  }
}
