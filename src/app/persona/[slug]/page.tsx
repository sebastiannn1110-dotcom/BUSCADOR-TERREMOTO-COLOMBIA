import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PhotoPlaceholder } from "@/components/photo-placeholder";
import { StatusBadge, VerificationBadge } from "@/components/status-badge";
import { getCase } from "@/lib/cases";
import { formatDate } from "@/lib/status";

export default async function PersonPage({ params }: { params: Promise<{ slug: string }> }) {
  const item = await getCase((await params).slug);
  if (!item) notFound();
  return <article className="case-detail">
    {item.is_test_data && <p className="test-label">DATOS DE PRUEBA — Personas, imágenes y situaciones ficticias.</p>}
    <div className="detail-top">
      <div className="detail-photo">{item.primary_public_photo_url ? <Image src={item.primary_public_photo_url} alt={`Foto publicada de ${item.full_name}`} fill priority /> : <PhotoPlaceholder />}</div>
      <div><h1>{item.full_name}</h1><StatusBadge status={item.condition_status} /><VerificationBadge level={item.verification_level} /><p className="lead">{item.public_description}</p></div>
    </div>
    <section className="facts"><h2>Información publicada</h2><dl>
      <div><dt>Edad aproximada</dt><dd>{item.approximate_age ?? "No informada"} {item.approximate_age !== null && "años"}</dd></div>
      <div><dt>Último lugar público conocido</dt><dd>{item.last_seen_location_public || "No informado"}</dd></div>
      <div><dt>Fecha y hora</dt><dd>{formatDate(item.last_seen_at)}</dd></div>
      <div><dt>Avistamientos aprobados</dt><dd>{item.approved_reports_count}</dd></div>
    </dl><p className="privacy-note">La ubicación puede ser aproximada para proteger a la persona y su familia. Los reportes sin aprobar no se muestran.</p></section>
    <section className="timeline"><h2>Avistamientos reportados</h2>
      {item.sightings?.length ? <ol>{item.sightings.map((sighting) => <li key={sighting.id}><span className="reviewed-badge">Revisado</span><strong>{formatDate(sighting.event_at)}</strong><span>{sighting.location_public}</span><p>{sighting.description}</p></li>)}</ol> : <p className="empty-sightings">No hay avistamientos públicos aprobados todavía.</p>}
    </section>
    <section id="informacion" className="information-cta"><h2>¿Tienes información?</h2><p>Se enviará a moderación. Nunca cambia el estado del caso automáticamente.</p><Link className="button" href={`/persona/${item.slug}/informacion`}>Enviar información</Link></section>
    <aside className="request-links"><Link href="/correccion">Solicitar corrección</Link><Link href="/retiro">Solicitar retiro</Link></aside>
  </article>;
}
