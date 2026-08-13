import Link from "next/link";
import { CaseCard } from "@/components/case-card";
import { PUBLIC_CASE_PAGE_SIZE, searchCases } from "@/lib/cases";

export const dynamic = "force-dynamic";

export default async function DeceasedPage({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const requestedPage = Number((await searchParams).pagina || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  let cases: Awaited<ReturnType<typeof searchCases>> = [];
  let unavailable = false;
  let hasMore = false;
  try {
    const candidates = await searchCases("", {
      status: "deceased_confirmed",
      ...(page > 1 ? { page: String(page) } : {})
    });
    hasMore = candidates.length === PUBLIC_CASE_PAGE_SIZE;
    cases = candidates.filter((item) => item.condition_status === "deceased_confirmed"
      && item.verification_level === "authority_confirmed");
  } catch {
    unavailable = true;
  }

  return <section className="search-page deceased-page">
    <p className="eyebrow">Información oficial revisada</p>
    <h1>Fallecidos confirmados</h1>
    <p className="lead">Personas identificadas oficialmente por Medicina Legal u otra fuente autorizada. Esta sección no acepta confirmaciones públicas de fallecimiento.</p>
    <div className="section-title compact-section-title">
      <p>{cases.length} registro{cases.length === 1 ? "" : "s"} en la página {page}</p>
      <Link href="/buscar?estado=deceased_confirmed">Buscar por nombre</Link>
    </div>
    {unavailable
      ? <p className="form-error" role="alert">No pudimos cargar esta información en este momento. Inténtalo nuevamente.</p>
      : cases.length
        ? <div className="case-grid">{cases.map((item) => <CaseCard key={item.id} item={item} />)}</div>
        : <p className="empty">{page > 1 ? "No hay más fallecimientos confirmados en esta página." : "No hay fallecimientos confirmados publicados."}</p>}
    {!unavailable && (page > 1 || hasMore) && <nav className="pagination" aria-label="Páginas de fallecidos confirmados">
      {page > 1 && <Link className="button secondary" href={page === 2 ? "/fallecidos" : `/fallecidos?pagina=${page - 1}`}>Página anterior</Link>}
      {hasMore && <Link className="button secondary" href={`/fallecidos?pagina=${page + 1}`}>Página siguiente</Link>}
    </nav>}
  </section>;
}
