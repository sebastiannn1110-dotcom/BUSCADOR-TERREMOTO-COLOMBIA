"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { PendingCaseReport } from "@/lib/types";

type QueueReport = PendingCaseReport;

const actions = [
  ["approved", "Aprobar"],
  ["rejected", "Rechazar"],
  ["duplicate", "Duplicado"],
  ["escalated", "Escalar"],
  ["request_information", "Solicitar información"]
] as const;

export function SightingsQueue() {
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

  async function moderate(event: FormEvent<HTMLFormElement>, reportId: string, action: string) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusyId(reportId);
    setError("");
    const response = await fetch("/api/admin/sightings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportId,
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
    {!reports.length ? <p className="empty">No hay reportes pendientes o escalados.</p> : <div className="moderation-list">{reports.map((report) => <article className="moderation-card" key={report.id}>
      <header><div><h2>{report.personName}</h2><p>{report.reportType} · {report.moderationStatus} · {report.urgencyLevel}</p></div>{report.hasEvidence && <span className="reviewed-badge">Tiene evidencia privada</span>}</header>
      <dl>
        <div><dt>Fecha informada</dt><dd>{report.eventAt || "No informada"}</dd></div>
        <div><dt>Ubicación privada</dt><dd>{report.locationPrivate || "No informada"}</dd></div>
        <div><dt>Descripción privada</dt><dd>{report.descriptionPrivate}</dd></div>
        <div><dt>Contacto privado</dt><dd>{[report.reporterName, report.phone, report.email, report.relationship].filter(Boolean).join(" · ") || "No informado"}</dd></div>
      </dl>
      <form className="report-form compact-form" onSubmit={(event) => moderate(event, report.id, ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value || "")}>
        <label>Justificación de la acción<textarea name="reason" minLength={3} maxLength={1000} required /></label>
        {report.reportType === "sighting" && <>
          <label>Ubicación pública aproximada<input name="publicLocation" maxLength={240} /></label>
          <label>Descripción pública revisada<textarea name="publicDescription" minLength={10} maxLength={800} /></label>
        </>}
        <div className="moderation-actions">{actions.map(([value, label]) => <button className={value === "approved" ? "button" : "button secondary"} type="submit" name="action" value={value} key={value} disabled={busyId === report.id}>{label}</button>)}</div>
      </form>
    </article>)}</div>}
  </>;
}
