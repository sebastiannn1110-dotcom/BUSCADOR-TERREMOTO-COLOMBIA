import Link from "next/link";
import { CaseCard } from "@/components/case-card";
import { PUBLIC_CASE_PAGE_SIZE, searchCases } from "@/lib/cases";

export const dynamic = "force-dynamic";

function deceasedHref(query: string, page: number) {
  const parameters = new URLSearchParams();
  if (query) parameters.set("q", query);
  if (page > 1) parameters.set("pagina", String(page));
  const value = parameters.toString();
  return `/fallecidos${value ? `?${value}` : ""}`;
}

export default async function DeceasedPage({ searchParams }: { searchParams: Promise<{ q?: string; pagina?: string }> }) {
  const parameters = await searchParams;
  const query = parameters.q?.trim() || "";
  const requestedPage = Number(parameters.pagina || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  let cases: Awaited<ReturnType<typeof searchCases>> = [];
  let unavailable = false;
  let hasMore = false;
  try {
    const candidates = await searchCases(query, {
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
    <p className="lead">Personas identificadas oficialmente. Información tomada de las listas de Medicina Legal u otra fuente autorizada.</p>
    <form action="/fallecidos" method="get" className="search-box">
      <label className="sr-only" htmlFor="deceased-search">Nombre de la persona</label>
      <input
        id="deceased-search"
        name="q"
        defaultValue={query}
        placeholder="Buscar por nombre"
        autoComplete="off"
      />
      <button className="button" type="submit">Buscar</button>
    </form>
    <p className="results-count">{cases.length} registro{cases.length === 1 ? "" : "s"} en la página {page}</p>
    {unavailable
      ? <p className="form-error" role="alert">No pudimos cargar esta información en este momento. Inténtalo nuevamente.</p>
      : cases.length
        ? <div className="case-grid">{cases.map((item) => <CaseCard key={item.id} item={item} />)}</div>
        : <p className="empty">{query
          ? "No encontramos fallecidos confirmados con ese nombre."
          : page > 1 ? "No hay más fallecimientos confirmados en esta página." : "No hay fallecimientos confirmados publicados."}</p>}
    {!unavailable && (page > 1 || hasMore) && <nav className="pagination" aria-label="Páginas de fallecidos confirmados">
      {page > 1 && <Link className="button secondary" href={deceasedHref(query, page - 1)}>Página anterior</Link>}
      {hasMore && <Link className="button secondary" href={deceasedHref(query, page + 1)}>Página siguiente</Link>}
    </nav>}
  </section>;
}
