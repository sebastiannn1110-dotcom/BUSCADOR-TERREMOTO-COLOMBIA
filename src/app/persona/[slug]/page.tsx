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
  const sightings = item.approved_sightings ?? item.sightings ?? [];
  const sightingCount = item.approved_sightings_count ?? item.approved_reports_count;
  const showTestLabel = process.env.NODE_ENV !== "production" && item.is_test_data;

  return <article className="case-detail">
    {showTestLabel && <p className="test-label">DATOS DE PRUEBA — Personas, imágenes y situaciones ficticias.</p>}
    <div className="detail-top">
      <div className="detail-photo">
        {item.primary_public_photo_url
          ? <Image src={item.primary_public_photo_url} alt={`Foto publicada de ${item.full_name}`} fill priority />
          : <PhotoPlaceholder />}
      </div>
      <div>
        <h1>{item.full_name}</h1>
        <StatusBadge
          status={item.condition_status}
          verificationLevel={item.verification_level}
          publicSourceLabel={item.public_source_label}
        />
        <VerificationBadge level={item.verification_level} />
        {item.public_description && <p className="lead">{item.public_description}</p>}
        <Link className="button detail-primary-action" href={`/persona/${item.slug}/informacion`}>Tengo información / La vi</Link>
      </div>
    </div>

    <section className="facts">
      <h2>Información publicada</h2>
      <dl>
        <div><dt>Edad aproximada</dt><dd>{item.approximate_age ?? "No informada"} {item.approximate_age !== null && "años"}</dd></div>
        <div><dt>Último lugar público conocido</dt><dd>{item.last_seen_location_public || "No informado"}</dd></div>
        <div><dt>Fecha y hora</dt><dd>{formatDate(item.last_seen_at)}</dd></div>
        <div><dt>Posibles avistamientos revisados</dt><dd>{sightingCount}</dd></div>
        {item.latest_approved_sighting_location
          && <div><dt>Último posible avistamiento</dt><dd>{item.latest_approved_sighting_location}</dd></div>}
      </dl>
      <p className="privacy-note">La ubicación puede ser aproximada para proteger a la persona y su familia. Los reportes pendientes nunca se muestran.</p>
    </section>

    <section className="timeline" aria-labelledby="sightings-title">
      <h2 id="sightings-title">Posibles avistamientos</h2>
      {sightings.length
        ? <ol>{sightings.map((sighting) => <li key={sighting.id}>
          <span className="reviewed-badge">Revisado por el equipo</span>
          <strong>{formatDate(sighting.event_at)}</strong>
          <span>{sighting.location_public || "Lugar aproximado no publicado"}</span>
          <p>{sighting.description}</p>
        </li>)}</ol>
        : <p className="empty-sightings">Todavía no hay posibles avistamientos revisados.</p>}
    </section>

    <section id="informacion" className="information-cta">
      <h2>¿Tienes información?</h2>
      <p>Tu información quedará privada hasta que el equipo la revise. Nunca cambia el estado del caso automáticamente.</p>
      <Link className="button" href={`/persona/${item.slug}/informacion`}>Tengo información / La vi</Link>
    </section>
    <aside className="request-links">
      <Link href={`/persona/${item.slug}/informacion?tipo=correction`}>Solicitar corrección</Link>
      <Link href="/retiro">Solicitar retiro</Link>
    </aside>
  </article>;
}
