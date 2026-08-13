"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { publicCasePath } from "@/lib/public-case-route";

type CaseMessage = {
  reportId: string;
  reportType: string;
  reportContext: string | null;
  moderationStatus: string;
  urgencyLevel: string;
  submittedAt: string;
  eventAt: string | null;
  descriptionPrivate: string;
  locationPrivate: string | null;
  contactId: string | null;
  reporterName: string | null;
  phone: string | null;
  email: string | null;
  relationship: string | null;
  preferredContactMethod: string | null;
  hasEvidence: boolean;
};

type FollowupMessage = {
  followupId: string;
  reportId: string | null;
  contactId: string | null;
  targetType: string;
  contactMethod: string;
  contactStatus: string;
  summaryPrivate: string;
  nextFollowupAt: string | null;
  createdAt: string;
};

type CaseThread = {
  caseId: string;
  caseSlug: string;
  personName: string;
  conditionStatus: string;
  publicationStatus: string;
  latestMessageAt: string;
  messages: CaseMessage[];
  followups: FollowupMessage[];
};

const reportLabels: Record<string, string> = {
  sighting: "Posible avistamiento",
  possible_trapped: "Posible atrapamiento",
  possible_deceased: "Información sensible sobre fallecimiento",
  correction: "Corrección o información",
  other_information: "Mensaje general"
};
const statusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  contactado: "Contactado",
  no_respondio: "No respondió",
  numero_errado: "Número errado",
  requiere_seguimiento: "Requiere seguimiento",
  cerrado: "Cerrado"
};

function formatDate(value: string | null | undefined) {
  if (!value) return "No informada";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function CaseMessageInbox() {
  const [threads, setThreads] = useState<CaseThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const response = await fetch("/api/admin/case-messages", { cache: "no-store" });
    const data = await response.json().catch(() => null) as { threads?: CaseThread[]; message?: string } | null;
    setLoading(false);
    if (!response.ok) {
      setError(data?.message || "No fue posible cargar los mensajes.");
      return;
    }
    setThreads(data?.threads || []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveFollowup(event: FormEvent<HTMLFormElement>, thread: CaseThread, message: CaseMessage) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const contactStatus = String(values.get("contactStatus") || "contactado");
    const localNextFollowup = String(values.get("nextFollowupAt") || "");
    if (contactStatus === "requiere_seguimiento" && !localNextFollowup) {
      setError("Indica la fecha del próximo seguimiento.");
      return;
    }
    setBusyId(message.reportId);
    setError("");
    setSuccess("");
    const response = await fetch("/api/admin/contact-followups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: thread.caseId,
        reportId: message.reportId,
        contactId: message.contactId,
        targetType: "informante",
        contactMethod: values.get("contactMethod"),
        contactStatus,
        summaryPrivate: values.get("summaryPrivate"),
        nextFollowupAt: localNextFollowup ? new Date(localNextFollowup).toISOString() : null
      })
    });
    const data = await response.json().catch(() => null) as { message?: string } | null;
    setBusyId("");
    if (!response.ok) {
      setError(data?.message || "No fue posible registrar el seguimiento.");
      return;
    }
    setSuccess("El seguimiento privado quedó registrado y auditado.");
    form.reset();
    await load();
  }

  if (loading) return <p role="status">Cargando mensajes privados…</p>;

  return <>
    <p className="privacy-note">Los mensajes enviados desde los formularios públicos llegan aquí. Los datos de contacto nunca se muestran a otros usuarios. Coordina cualquier conexión solo con consentimiento de las personas involucradas.</p>
    <p className="privacy-note">Esta bandeja registra el seguimiento; no envía respuestas automáticas. Usa el medio autorizado por el informante y deja constancia privada del resultado.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {success && <p className="success" role="status">{success}</p>}
    {!threads.length ? <p className="empty">Todavía no hay mensajes recibidos.</p> : <div className="moderation-list">{threads.map((thread) => <article className="moderation-card" key={thread.caseId}>
      <header>
        <div><h2>{thread.personName}</h2><p>Último mensaje: {formatDate(thread.latestMessageAt)}</p></div>
        {thread.publicationStatus === "published" && <Link href={publicCasePath(thread.caseSlug)}>Ver ficha pública</Link>}
      </header>
      <section aria-label={`Conversación privada sobre ${thread.personName}`}>
        <h3>Mensajes recibidos</h3>
        {thread.messages.map((message) => <div className="contact-message" key={message.reportId}>
          <p><strong>{reportLabels[message.reportType] || "Mensaje recibido desde la web"}</strong> · {formatDate(message.submittedAt)}</p>
          <p>{message.descriptionPrivate}</p>
          {message.locationPrivate && <p><strong>Lugar privado:</strong> {message.locationPrivate}</p>}
          <dl>
            <div><dt>Informante</dt><dd>{message.reporterName || "No informado"}</dd></div>
            <div><dt>Teléfono privado</dt><dd>{message.phone || "No informado"}</dd></div>
            <div><dt>Correo privado</dt><dd>{message.email || "No informado"}</dd></div>
            <div><dt>Medio preferido</dt><dd>{message.preferredContactMethod || "No informado"}</dd></div>
          </dl>
          <form className="report-form compact-form" onSubmit={(event) => saveFollowup(event, thread, message)}>
            <label>Medio usado<select name="contactMethod" defaultValue={message.preferredContactMethod || "llamada"}>
              <option value="llamada">Llamada</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="correo">Correo</option><option value="presencial">Presencial</option><option value="otro">Otro</option>
            </select></label>
            <label>Resultado<select name="contactStatus" defaultValue="contactado">
              {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
            <label>Nota privada del seguimiento<textarea name="summaryPrivate" minLength={3} maxLength={2000} required /></label>
            <label>Próximo seguimiento, si aplica<input name="nextFollowupAt" type="datetime-local" /></label>
            <button className="button" type="submit" disabled={busyId === message.reportId}>{busyId === message.reportId ? "Guardando…" : "Registrar seguimiento"}</button>
          </form>
        </div>)}
        {thread.followups.length > 0 && <>
          <h3>Historial interno</h3>
          <ol className="timeline">{thread.followups.map((followup) => <li key={followup.followupId}>
            <strong>{statusLabels[followup.contactStatus] || followup.contactStatus} · {formatDate(followup.createdAt)}</strong>
            <p>{followup.summaryPrivate}</p>
            {followup.nextFollowupAt && <p>Próximo seguimiento: {formatDate(followup.nextFollowupAt)}</p>}
          </li>)}</ol>
        </>}
      </section>
    </article>)}</div>}
  </>;
}
