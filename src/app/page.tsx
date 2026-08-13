import Link from "next/link";
import { SearchBox } from "@/components/search-box";
import { CaseCard } from "@/components/case-card";
import { brand } from "@/lib/brand";
import { searchCases } from "@/lib/cases";

export const dynamic = "force-dynamic";

export default async function Home() {
  let recent: Awaited<ReturnType<typeof searchCases>> = [];
  try {
    recent = (await searchCases()).slice(0, 3);
  } catch {
    // The landing page and reporting entry point remain available if search is temporarily unavailable.
  }
  const aiAvailable = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);

  return <>
    <section className="hero">
      <p className="eyebrow">{brand.name}</p>
      <h1>Encuentra a tu familiar</h1>
      <p className="lead">Busca por nombre o cuéntanos a quién estás buscando.</p>
      <SearchBox large />
      {aiAvailable
        ? <Link className="text-button" href="/buscar/ia">Buscar con ayuda de la IA</Link>
        : <>
          <p className="hint">La ayuda conversacional no está disponible en este momento.</p>
          <Link className="text-button" href="/buscar">Usar búsqueda normal</Link>
        </>}
    </section>

    <section className="category-grid" aria-labelledby="categories-heading">
      <h2 id="categories-heading" className="sr-only">Categorías principales</h2>
      <article className="category-panel missing-category">
        <p className="category-kicker">Búsqueda y reunificación</p>
        <h2>Desaparecidos</h2>
        <p>Personas reportadas como desaparecidas y casos publicados después de revisión.</p>
        <Link className="button" href="/buscar?estado=missing">Ver desaparecidos</Link>
      </article>
      <article className="category-panel deceased-category">
        <p className="category-kicker">Información oficial</p>
        <h2>Fallecidos confirmados</h2>
        <p>Personas identificadas oficialmente. Información tomada de Medicina Legal u otra fuente autorizada.</p>
        <Link className="button secondary" href="/fallecidos">Ver fallecidos confirmados</Link>
      </article>
    </section>

    <section className="action-grid secondary-actions" aria-label="Otras acciones">
      <Link href="/reportar-desaparecido" className="action">
        <span aria-hidden>＋</span>
        <strong>Reportar a una persona desaparecida</strong>
        <small>Tu reporte será revisado antes de publicarse.</small>
      </Link>
      <Link href="/buscar" className="action">
        <span aria-hidden>⌁</span>
        <strong>Tengo información sobre alguien</strong>
        <small>Envía información de forma privada para revisión.</small>
      </Link>
    </section>

    <section className="content-section">
      <div className="section-title">
        <div><h2>Actualizados recientemente</h2><p>Solo información aprobada para consulta pública.</p></div>
        <Link href="/buscar">Ver todos</Link>
      </div>
      {recent.length
        ? <div className="case-grid">{recent.map((item) => <CaseCard key={item.id} item={item} />)}</div>
        : <p className="empty">Aún no hay casos publicados para consulta.</p>}
    </section>

    <section className="how">
      <h2>Cómo funciona</h2>
      <ol>
        <li>Busca por nombre, lugar o estado.</li>
        <li>Consulta solo los datos aprobados para publicación.</li>
        <li>Envía información privada para revisión del equipo.</li>
      </ol>
    </section>
  </>;
}
