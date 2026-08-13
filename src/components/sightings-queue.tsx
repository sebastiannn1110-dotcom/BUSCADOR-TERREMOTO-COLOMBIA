"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { PendingCaseReport } from "@/lib/types";

type EvidenceAsset = { id: string; assetType?: string | null; mimeType?: string | null; sizeBytes?: number | null; originalFilename?: string | null };
type QueueReport = PendingCaseReport & { reportContext?: string | null; evidenceAssets?: EvidenceAsset[] };

const actions = [
  ["approved", "Aprobar"],
  ["rejected", "Rechazar"],
  ["duplicate", "Duplicado"],
  ["escalated", "Escalar"],
  ["request_information", "Solicitar información"]
] as const;

const reportLabels: Record<string, string> = {
  sighting: "Posible avistamiento",
  possible_trapped: "Posible atrapamiento",
  possible_deceased: "Información sobre posible fallecimiento",
  correction: "Corrección",
  other_information: "Otra información"
};
const moderationLabels: Record<string, string> = { pending: "Pendiente", escalated: "Escalado" };
const urgencyLabels: Record<string, string> = { normal: "Normal", priority: "Prioritaria", urgent: "Urgente", critical: "Crítica" };
const contextLabels: Record<string, string> = { sighting_alive: "Vista con vida", sighting_care: "Hospital, refugio o punto de atención" };

export function SightingsQueue({ canModerate = true }: { canModerate?: boolean }) {
  const [reports, setReports] = useState<QueueReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/admin/sightings", { cache: "no-store" });
    const data = await response.json().catch(() => null) as { reports?: QueueReport[]; message?: string } | null;
    setLoading(false);
    if (!response.ok) { setError(data?.message || "No fue posible cargar la cola."); return; }
    setReports(data?.reports || []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function moderate(event: FormEvent<HTMLFormElement>, report: QueueReport, action: string) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (action === "approved" && report.reportType === "sighting" && (!String(values.get("publicLocation") || "").trim() || String(values.get("publicDescription") || "").trim().length < 10)) {
      setError("Para aprobar un posible avistamiento, completa el lugar público aproximado y una descripción pública revisada de al menos 10 caracteres.");
      return;
    }
    setBusyId(report.id);
    setError("");
    const response = await fetch("/api/admin/sightings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportId: report.id,
        action,
        reason: values.get("reason"),
        publicLocation: values.get("publicLocation"),
        publicDescription: values.get("publicDescription")
      })
    });
    const data = await response.json().catch(() => null) as { message?: string } | null;
    setBusyId("");
    if (!response.ok) { setError(data?.message || "No fue posible moderar el reporte."); return; }
    await load();
  }

  if (loading) return <p role="status">Cargando reportes pendientes…</p>;
  return <>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!canModerate && <p className="privacy-note">Acceso de consulta: solo moderadores y administradores pueden guardar acciones.</p>}
    {!reports.length ? <p className="empty">No hay reportes pendientes o escalados.</p> : <div className="moderation-list">{reports.map((report) => <article className="moderation-card" key={report.id}>
      <header><div><h2>{report.personName}</h2><p>{reportLabels[report.reportType] || "Información"} · {moderationLabels[report.moderationStatus] || "En revisión"} · {urgencyLabels[report.urgencyLevel] || "Normal"}</p></div>{report.hasEvidence && <span className="reviewed-badge">Tiene evidencia privada</span>}</header>
      <dl>
        {report.reportContext && <div><dt>Contexto del reporte</dt><dd>{contextLabels[report.reportContext] || "Información recibida"}</dd></div>}
        <div><dt>Fecha informada</dt><dd>{report.eventAt || "No informada"}</dd></div>
        <div><dt>Ubicación privada</dt><dd>{report.locationPrivate || "No informada"}</dd></div>
        <div><dt>Descripción privada</dt><dd>{report.descriptionPrivate}</dd></div>
        <div><dt>Contacto privado</dt><dd>{[report.reporterName, report.phone, report.email, report.relationship].filter(Boolean).join(" · ") || "No informado"}</dd></div>
      </dl>
      {report.evidenceAssets && report.evidenceAssets.length > 0 && <section aria-label={`Evidencia privada del reporte sobre ${report.personName}`}>
        <h3>Evidencia privada</h3>
        <div className="moderation-actions">{report.evidenceAssets.map((asset) => <div key={asset.id}>
          {asset.mimeType?.startsWith("image/")
            ? <Image unoptimized src={`/api/admin/private-media/${asset.id}`} alt="Evidencia privada; solo visible para personal autorizado" width={220} height={220} />
            : <a href={`/api/admin/private-media/${asset.id}`}>Abrir evidencia privada</a>}
          <small>{asset.originalFilename || asset.assetType || "Archivo adjunto"}{asset.sizeBytes ? ` · ${Math.ceil(asset.sizeBytes / 1024)} KB` : ""}</small>
        </div>)}</div>
      </section>}
      {canModerate && <form className="report-form compact-form" onSubmit={(event) => moderate(event, report, ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value || "")}>
        <label>Justificación de la acción<textarea name="reason" minLength={3} maxLength={1000} required /></label>
        {report.reportType === "sighting" && <>
          <label>Ubicación pública aproximada<input name="publicLocation" maxLength={240} /></label>
          <label>Descripción pública revisada<textarea name="publicDescription" minLength={10} maxLength={800} /></label>
        </>}
        <div className="moderation-actions">{actions
          .filter(([value]) => value !== "approved" || report.reportType === "sighting")
          .map(([value, label]) => <button className={value === "approved" ? "button" : "button secondary"} type="submit" name="action" value={value} key={value} disabled={busyId === report.id}>{value === "approved" ? "Aprobar como posible avistamiento público" : label}</button>)}</div>
      </form>}
      <p><Link href={`/admin/seguimiento-contactos?reportId=${encodeURIComponent(report.id)}`}>{canModerate ? "Registrar contacto" : "Ver seguimiento de contacto"}</Link></p>
    </article>)}</div>}
  </>;
}
