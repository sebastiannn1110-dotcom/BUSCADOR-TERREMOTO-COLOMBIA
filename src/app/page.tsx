import Link from "next/link";
import { SearchBox } from "@/components/search-box";
import { CaseCard } from "@/components/case-card";
import { brand } from "@/lib/brand";
import { searchCases } from "@/lib/cases";

export const dynamic = "force-dynamic";

export default async function Home() {
  let recent: Awaited<ReturnType<typeof searchCases>> = [];
  try { recent = (await searchCases()).slice(0, 3); } catch { /* Keep the public landing page available during a database outage. */ }
  const aiAvailable = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
  return <><section className="hero"><p className="eyebrow">{brand.name}</p><h1>Encuentra a tu familiar</h1><p className="lead">Busca por nombre o cuéntanos a quién estás buscando.</p><SearchBox large />{aiAvailable ? <Link className="text-button" href="/buscar/ia">Buscar con ayuda de la IA</Link> : <><p className="hint">La ayuda conversacional no está disponible en este momento.</p><Link className="text-button" href="/buscar">Usar búsqueda normal</Link></>}</section><section className="action-grid" aria-label="Acciones principales"><Link href="/reportar-desaparecido" className="action"><span aria-hidden>＋</span><strong>Reportar a una persona desaparecida</strong><small>Tu reporte será revisado antes de publicarse.</small></Link><Link href="/buscar" className="action"><span aria-hidden>⌁</span><strong>Tengo información sobre alguien</strong><small>Envía un avistamiento o información de forma segura.</small></Link><Link href="/buscar" className="action"><span aria-hidden>⌕</span><strong>Ver todos los casos</strong><small>Consulta los casos publicados.</small></Link></section><section className="content-section"><div className="section-title"><div><h2>Actualizados recientemente</h2><p>Solo información aprobada para consulta pública.</p></div><Link href="/buscar">Ver todos</Link></div>{recent.length ? <div className="case-grid">{recent.map((item) => <CaseCard key={item.id} item={item} />)}</div> : <p className="empty">Aún no hay casos públicos. Configura Supabase o activa los datos de demostración en un entorno de desarrollo.</p>}</section><section className="how"><h2>Cómo funciona</h2><ol><li>Busca por nombre, lugar o estado.</li><li>Consulta solo los datos aprobados para publicación.</li><li>Envía información para una revisión humana antes de su publicación.</li></ol></section></>;
}
