"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CaseCard } from "@/components/case-card";
import { SearchBox } from "@/components/search-box";
import type { CaseCard as Item } from "@/lib/types";

const filters = [
  { value: "", label: "Todos" },
  { value: "missing", label: "Desaparecidos" },
  { value: "deceased_confirmed", label: "Fallecidos confirmados" }
] as const;

export function SearchResults({ initialQuery, initialStatus, initialPage = "1" }: { initialQuery: string; initialStatus: string; initialPage?: string }) {
  const [results, setResults] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const parsedPage = Number(initialPage);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const activeStatus = filters.find((filter) => filter.value === initialStatus)?.value ?? "";

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const parameters = new URLSearchParams({ q: initialQuery });
    if (activeStatus) parameters.set("estado", activeStatus);
    if (page > 1) parameters.set("pagina", String(page));
    fetch(`/api/search?${parameters.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((data: { results?: Item[]; hasMore?: boolean }) => {
        setResults(Array.isArray(data.results) ? data.results : []);
        setHasMore(data.hasMore === true);
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setError("No pudimos cargar los resultados. Inténtalo nuevamente.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [initialQuery, activeStatus, page]);

  function filterHref(status: string) {
    const parameters = new URLSearchParams();
    if (initialQuery) parameters.set("q", initialQuery);
    if (status) parameters.set("estado", status);
    const query = parameters.toString();
    return `/buscar${query ? `?${query}` : ""}`;
  }

  function pageHref(nextPage: number) {
    const parameters = new URLSearchParams();
    if (initialQuery) parameters.set("q", initialQuery);
    if (activeStatus) parameters.set("estado", activeStatus);
    if (nextPage > 1) parameters.set("pagina", String(nextPage));
    const query = parameters.toString();
    return `/buscar${query ? `?${query}` : ""}`;
  }

  return <section className="search-page">
    <h1>Buscar personas</h1>
    <p className="lead">Escribe un nombre completo, parte del nombre o un lugar.</p>
    <SearchBox initial={initialQuery} />
    <nav className="status-filters" aria-label="Filtrar por estado">
      {filters.map((filter) => <Link
        key={filter.value || "all"}
        href={filterHref(filter.value)}
        className={activeStatus === filter.value ? "active" : ""}
        aria-current={activeStatus === filter.value ? "page" : undefined}
      >{filter.label}</Link>)}
    </nav>
    <p className="results-count" aria-live="polite">{loading ? "Buscando casos…" : `${results.length} coincidencia${results.length === 1 ? "" : "s"}`}</p>
    {!loading && page > 1 && <p className="page-indicator">Página {page}</p>}
    {error
      ? <p className="form-error" role="alert">{error}</p>
      : loading
        ? <div className="case-grid skeletons" aria-hidden="true"><div /><div /><div /></div>
        : results.length
          ? <div className="case-grid">{results.map((item) => <CaseCard key={item.id} item={item} />)}</div>
          : <div className="empty">
            <h2>No encontramos coincidencias</h2>
            <p>Prueba con una parte del nombre, sin tildes, o revisa la ortografía.</p>
            <Link className="button" href="/reportar-desaparecido">Reportar a una persona</Link>
          </div>}
    {!loading && !error && (page > 1 || hasMore) && <nav className="pagination" aria-label="Páginas de resultados">
      {page > 1 && <Link className="button secondary" href={pageHref(page - 1)}>Página anterior</Link>}
      {hasMore && <Link className="button secondary" href={pageHref(page + 1)}>Página siguiente</Link>}
    </nav>}
  </section>;
}
