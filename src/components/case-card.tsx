import Image from "next/image";
import Link from "next/link";
import { PhotoPlaceholder } from "@/components/photo-placeholder";
import { formatDate } from "@/lib/status";
import type { CaseCard as CaseCardType } from "@/lib/types";
import { StatusBadge, VerificationBadge } from "./status-badge";

export function CaseCard({ item }: { item: CaseCardType }) {
  const deceased = item.condition_status === "deceased_confirmed";
  const medicinaLegal = item.public_source_label?.trim().toLocaleLowerCase("es") === "medicina legal";
  const reportedPlace = item.reported_unit || item.last_seen_location_public;
  const sightingCount = item.approved_sightings_count ?? item.approved_reports_count;
  const showTestLabel = process.env.NODE_ENV !== "production" && item.is_test_data;

  return <article className={`case-card${deceased ? " deceased-card" : ""}`}>
    <Link href={`/persona/${item.slug}`} className="card-link" aria-label={`Ver caso de ${item.full_name}`}>
      <div className="portrait">
        {item.primary_public_photo_url
          ? <Image src={item.primary_public_photo_url} alt={`Foto publicada de ${item.full_name}`} fill sizes="(max-width: 700px) 100vw, 33vw" />
          : <PhotoPlaceholder />}
      </div>
      <div className="card-body">
        {showTestLabel && <p className="test-label">DATOS DE PRUEBA</p>}
        <h3>{item.full_name}</h3>
        {item.approximate_age !== null && (deceased
          ? <p><strong>Edad:</strong> {item.approximate_age} años</p>
          : <p>{item.approximate_age} años aproximados</p>)}
        <StatusBadge
          status={item.condition_status}
          verificationLevel={item.verification_level}
          publicSourceLabel={item.public_source_label}
        />
        <VerificationBadge level={item.verification_level} />
        {deceased
          ? <>
            <dl>
              <div><dt>Unidad básica / lugar reportado</dt><dd>{reportedPlace || "No informado"}</dd></div>
            </dl>
            {medicinaLegal && <p>Información tomada de las listas de Medicina Legal</p>}
          </>
          : <dl>
            <div><dt>Último lugar conocido</dt><dd>{item.last_seen_location_public || "No informado"}</dd></div>
            <div><dt>Última actualización</dt><dd>{formatDate(item.updated_at)}</dd></div>
            <div><dt>Posibles avistamientos revisados</dt><dd>{sightingCount}</dd></div>
            {item.latest_approved_sighting_location
              && <div><dt>Último posible avistamiento</dt><dd>{item.latest_approved_sighting_location}</dd></div>}
          </dl>}
      </div>
    </Link>
    <div className="card-actions">
      <Link className={deceased ? "button" : "button secondary"} href={`/persona/${item.slug}`}>Ver caso</Link>
      <Link className={deceased ? "button secondary" : "button"} href={`/persona/${item.slug}/informacion${deceased ? "?tipo=correction" : ""}`}>
        {deceased ? "Tengo una corrección o información" : "Tengo información / La vi"}
      </Link>
    </div>
  </article>;
}
