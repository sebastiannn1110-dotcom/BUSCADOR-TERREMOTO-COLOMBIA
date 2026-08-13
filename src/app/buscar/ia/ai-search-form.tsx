"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { CaseCard } from "@/components/case-card";
import type { CaseCard as Item } from "@/lib/types";

type SearchResponse = {
  message?: string;
  results?: Item[];
};

export function AiSearchForm({ available }: { available: boolean }) {
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const normalSearchHref = query.trim() ? `/buscar?q=${encodeURIComponent(query.trim())}` : "/buscar";

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setError("Escribe a quién buscas para iniciar la búsqueda.");
      setMessage("");
      setItems([]);
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    setItems([]);

    try {
      const response = await fetch("/api/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmedQuery })
      });
      const data = await response.json().catch(() => null) as SearchResponse | null;
      const responseMessage = data?.message || "No pudimos completar la búsqueda conversacional.";

      if (!response.ok) {
        setError(responseMessage);
        return;
      }

      setMessage(responseMessage);
      setItems(Array.isArray(data?.results) ? data.results : []);
    } catch {
      setError("No pudimos completar la búsqueda conversacional. Puedes usar la búsqueda normal.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="search-page">
    <h1>Buscar con ayuda conversacional</h1>
    <p className="lead">Describe a quién buscas. La respuesta solo consulta casos publicados; no inventa personas ni estados.</p>
    {!available ? <div className="availability-notice" role="status">
      <h2>La ayuda conversacional no está disponible</h2>
      <p>La búsqueda normal sigue disponible para consultar los casos publicados.</p>
      <Link className="button" href="/buscar">Usar búsqueda normal</Link>
    </div> : <>
      <form className="report-form" onSubmit={ask} aria-busy={busy}>
        <label htmlFor="ai-query">Tu consulta</label>
        <textarea id="ai-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busco a Valeria Montes" required aria-describedby="ai-search-help" />
        <p id="ai-search-help" className="hint">No incluyas teléfonos, correos, direcciones exactas ni otra información privada. Tu consulta se procesa con OpenAI únicamente para buscar casos públicos.</p>
        {error && <div className="form-error" role="alert"><p>{error}</p><Link href={normalSearchHref}>Usar búsqueda normal</Link></div>}
        <button className="button" type="submit" disabled={busy}>{busy ? "Buscando…" : "Buscar"}</button>
      </form>
      {message && <p className="ai-answer" role="status" aria-live="polite">{message}</p>}
      {items.length > 0 && <div className="case-grid">{items.map((item) => <CaseCard item={item} key={item.id} />)}</div>}
    </>}
  </section>;
}
