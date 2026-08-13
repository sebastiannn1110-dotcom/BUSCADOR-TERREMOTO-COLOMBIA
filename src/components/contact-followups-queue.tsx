"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type ContactQueueItem = {
  caseId: string;
  reportId: string | null;
  contactId: string | null;
  personName: string;
  caseSlug: string | null;
  reportType: string;
  reportContext?: string | null;
  urgencyLevel: string;
  moderationStatus: string;
  submittedAt: string;
  eventAt: string | null;
  locationPrivate: string | null;
  descriptionPrivate: string;
  reporterName: string | null;
  phone: string | null;
  email: string | null;
  relationship: string | null;
  initialContact?: {
    contactId: string;
    reporterName: string | null;
    phone: string | null;
    email: string | null;
    relationship: string | null;
  } | null;
  lastFollowupStatus: string | null;
  nextFollowupAt: string | null;
  followupCount: number;
  hasEvidence: boolean;
};

const reportTypeLabels: Record<string, string> = {
  sighting: "Posible avistamiento",
  possible_trapped: "Posible atrapamiento",
  possible_deceased: "Información sobre posible fallecimiento",
  correction: "Corrección",
  other_information: "Otra información"
};

const contactStatusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  contactado: "Contactado",
  no_respondio: "No respondió",
  numero_errado: "Número errado",
  requiere_seguimiento: "Requiere seguimiento",
  cerrado: "Cerrado"
};
const moderationLabels: Record<string, string> = {
  pending: "Pendiente",
  escalated: "Escalado",
  approved: "Aprobado",
  rejected: "Rechazado",
  duplicate: "Duplicado"
};
const urgencyLabels: Record<string, string> = { normal: "Normal", priority: "Prioritaria", urgent: "Urgente", critical: "Crítica" };
const contextLabels: Record<string, string> = { sighting_alive: "Vista con vida", sighting_care: "Hospital, refugio o punto de atención" };

function formatDate(value: string | null | undefined) {
  if (!value) return "No informada";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function itemKey(item: ContactQueueItem) {
  return `${item.caseId}-${item.reportId || item.contactId || "case"}`;
}

export function ContactFollowupsQueue({
  initialCaseId = "",
  initialReportId = "",
  canWrite = true
}: {
  initialCaseId?: string;
  initialReportId?: string;
  canWrite?: boolean;
}) {
  const [items, setItems] = useState<ContactQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const response = await fetch("/api/admin/contact-followups", { cache: "no-store" });
    const data = await response.json().catch(() => null) as { items?: ContactQueueItem[]; message?: string } | null;
    setLoading(false);
    if (!response.ok) {
      setError(data?.message || "No fue posible cargar la cola de contactos.");
      return;
    }
    setItems(data?.items || []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const orderedItems = useMemo(() => [...items].sort((left, right) => {
    const leftSelected = (initialReportId && left.reportId === initialReportId) || (initialCaseId && left.caseId === initialCaseId);
    const rightSelected = (initialReportId && right.reportId === initialReportId) || (initialCaseId && right.caseId === initialCaseId);
    return Number(rightSelected) - Number(leftSelected);
  }), [items, initialCaseId, initialReportId]);

  async function saveFollowup(event: FormEvent<HTMLFormElement>, item: ContactQueueItem) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const operation = submitter?.value || "register";
    const values = new FormData(event.currentTarget);
    const targetType = String(values.get("targetType") || "informante");
    const contactSource = String(values.get("contactSource") || "informant");
    const usingInitialContact = contactSource === "initial" || Boolean(!item.contactId && item.initialContact);
    const selectedContactId = usingInitialContact
      ? item.initialContact?.contactId || item.contactId
      : item.contactId;
    const selectedTargetType = usingInitialContact && targetType === "informante" ? "reportante_inicial" : targetType;
    const selectedStatus = String(values.get("contactStatus") || "pendiente");
    const contactStatus = operation === "followup" ? "requiere_seguimiento" : operation === "close" ? "cerrado" : selectedStatus;
    const localNextFollowup = String(values.get("nextFollowupAt") || "");
    if (contactStatus === "requiere_seguimiento" && !localNextFollowup) {
      setError("Indica la fecha del próximo seguimiento.");
      return;
    }
    const nextFollowupAt = localNextFollowup ? new Date(localNextFollowup).toISOString() : null;
    const key = itemKey(item);
    setBusyKey(key);
    setError("");
    setSuccess("");
    const response = await fetch("/api/admin/contact-followups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: item.caseId,
        reportId: usingInitialContact ? null : item.reportId,
        contactId: selectedContactId,
        targetType: selectedTargetType,
        contactMethod: values.get("contactMethod"),
        contactStatus,
        summaryPrivate: values.get("summaryPrivate"),
        nextFollowupAt
      })
    });
    const data = await response.json().catch(() => null) as { message?: string } | null;
    setBusyKey("");
    if (!response.ok) {
      setError(data?.message || "No fue posible registrar el contacto.");
      return;
    }
    setSuccess("La acción de contacto quedó registrada y auditada.");
    form.reset();
    await load();
  }

  if (loading) return <p role="status">Cargando seguimientos de contacto…</p>;

  return <>
    <nav className="moderation-actions" aria-label="Áreas administrativas">
      <Link href="/admin/personas-pendientes">Personas pendientes</Link>
      <Link href="/admin/avistamientos">Posibles avistamientos</Link>
    </nav>
    {error && <p className="form-error" role="alert">{error}</p>}
    {success && <p className="success" role="status">{success}</p>}
    {!canWrite && <p className="privacy-note">Acceso de consulta: solo moderadores y administradores pueden registrar acciones.</p>}
    {!orderedItems.length ? <p className="empty">No hay reportes o contactos que requieran seguimiento.</p> : <div className="moderation-list">{orderedItems.map((item) => {
      const key = itemKey(item);
      const selected = (initialReportId && item.reportId === initialReportId) || (initialCaseId && item.caseId === initialCaseId);
      return <article className="moderation-card" id={`contact-${key}`} key={key}>
        <header>
          <div><h2>{item.personName}</h2><p>{reportTypeLabels[item.reportType] || "Información"} · {moderationLabels[item.moderationStatus] || "Estado no reconocido"} · {urgencyLabels[item.urgencyLevel] || "Normal"}</p></div>
          {selected && <span className="reviewed-badge">Reporte seleccionado</span>}
          {item.hasEvidence && <span className="reviewed-badge">Tiene evidencia privada</span>}
        </header>
        <dl>
          {item.reportContext && <div><dt>Contexto</dt><dd>{contextLabels[item.reportContext] || "Información recibida"}</dd></div>}
          <div><dt>Información recibida</dt><dd>{item.descriptionPrivate}</dd></div>
          <div><dt>Lugar privado</dt><dd>{item.locationPrivate || "No informado"}</dd></div>
          <div><dt>Fecha del hecho</dt><dd>{formatDate(item.eventAt)}</dd></div>
          <div><dt>Fecha del reporte</dt><dd>{formatDate(item.submittedAt)}</dd></div>
          <div><dt>Persona de contacto</dt><dd>{item.reporterName || "No informada"}</dd></div>
          <div><dt>Número privado</dt><dd>{item.phone || "No informado"}</dd></div>
          <div><dt>Correo privado</dt><dd>{item.email || "No informado"}</dd></div>
          {item.relationship && <div><dt>Relación</dt><dd>{item.relationship}</dd></div>}
          {item.initialContact && item.initialContact.contactId !== item.contactId && <>
            <div><dt>Reportante inicial o familia</dt><dd>{item.initialContact.reporterName || "No informado"}</dd></div>
            <div><dt>Número privado del reporte inicial</dt><dd>{item.initialContact.phone || "No informado"}</dd></div>
            <div><dt>Correo privado del reporte inicial</dt><dd>{item.initialContact.email || "No informado"}</dd></div>
            {item.initialContact.relationship && <div><dt>Relación del reporte inicial</dt><dd>{item.initialContact.relationship}</dd></div>}
          </>}
          <div><dt>Seguimientos registrados</dt><dd>{item.followupCount || 0}</dd></div>
          <div><dt>Último estado</dt><dd>{item.lastFollowupStatus ? contactStatusLabels[item.lastFollowupStatus] || item.lastFollowupStatus : "Sin seguimiento"}</dd></div>
          <div><dt>Próximo seguimiento</dt><dd>{formatDate(item.nextFollowupAt)}</dd></div>
        </dl>
        {canWrite && <form className="report-form compact-form" onSubmit={(event) => saveFollowup(event, item)}>
          {item.initialContact && item.initialContact.contactId !== item.contactId && <label>Contacto sobre el que se registra<select name="contactSource" defaultValue="informant">
            <option value="informant">Informante de este reporte</option>
            <option value="initial">Reportante inicial o familia</option>
          </select></label>}
          <label>Tipo de contacto<select name="targetType" defaultValue={item.reportId ? "informante" : "reportante_inicial"}>
            <option value="reportante_inicial">Reportante inicial</option>
            <option value="informante">Informante</option>
            <option value="familia">Familia</option>
            <option value="otro">Otro</option>
          </select></label>
          <label>Método<select name="contactMethod" defaultValue="llamada">
            <option value="llamada">Llamada</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
            <option value="correo">Correo</option>
            <option value="presencial">Presencial</option>
            <option value="otro">Otro</option>
          </select></label>
          <label>Resultado<select name="contactStatus" defaultValue="contactado">
            {Object.entries(contactStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select></label>
          <label>Resumen privado<textarea name="summaryPrivate" minLength={3} maxLength={2000} required /></label>
          <label>Próximo seguimiento, si aplica<input name="nextFollowupAt" type="datetime-local" /></label>
          <div className="moderation-actions">
            <button className="button" type="submit" name="operation" value="register" disabled={busyKey === key}>Registrar contacto</button>
            <button className="button secondary" type="submit" name="operation" value="followup" disabled={busyKey === key}>Marcar para seguimiento</button>
            <button className="button secondary" type="submit" name="operation" value="close" disabled={busyKey === key}>Cerrar seguimiento</button>
          </div>
        </form>}
      </article>;
    })}</div>}
  </>;
}
