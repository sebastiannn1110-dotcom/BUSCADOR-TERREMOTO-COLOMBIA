"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { publicCasePath } from "@/lib/public-case-route";

type ManagedPerson = {
  caseId: string;
  slug: string;
  fullName: string;
  approximateAge: number | null;
  conditionStatus: string;
  verificationLevel: string;
  publicationStatus: string;
  reportedUnit: string | null;
  publicLocation: string | null;
  publishedAt: string | null;
  withdrawnAt: string | null;
  updatedAt: string;
};

const conditionLabels: Record<string, string> = {
  missing: "Desaparecida",
  possibly_trapped: "Posiblemente atrapada",
  located_alive: "Localizada con vida",
  reunited: "Reunificada",
  deceased_confirmed: "Fallecimiento confirmado",
  closed: "Cerrado"
};
const publicationLabels: Record<string, string> = {
  published: "Publicada",
  hidden: "Oculta",
  archived: "Retirada"
};

function formatDate(value: string | null | undefined) {
  if (!value) return "No informada";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AdminPeopleManager({ canWithdraw }: { canWithdraw: boolean }) {
  const [people, setPeople] = useState<ManagedPerson[]>([]);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async (search = activeQuery) => {
    setLoading(true);
    setError("");
    const response = await fetch(`/api/admin/people?q=${encodeURIComponent(search)}`, { cache: "no-store" });
    const data = await response.json().catch(() => null) as { people?: ManagedPerson[]; message?: string } | null;
    setLoading(false);
    if (!response.ok) {
      setError(data?.message || "No fue posible cargar las personas publicadas.");
      return;
    }
    setPeople(data?.people || []);
  }, [activeQuery]);

  useEffect(() => { void load(); }, [load]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = query.trim();
    setActiveQuery(next);
    void load(next);
  }

  async function withdraw(event: FormEvent<HTMLFormElement>, item: ManagedPerson) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (values.get("confirm") !== "on") {
      setError("Confirma expresamente el retiro antes de continuar.");
      return;
    }
    setBusyId(item.caseId);
    setError("");
    setSuccess("");
    const response = await fetch("/api/admin/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: item.caseId, reason: values.get("reason") })
    });
    const data = await response.json().catch(() => null) as { message?: string } | null;
    setBusyId("");
    if (!response.ok) {
      setError(data?.message || "No fue posible retirar la persona del buscador.");
      return;
    }
    setSuccess(`${item.fullName} fue retirada del buscador. El registro y la auditoría se conservaron.`);
    await load();
  }

  return <>
    <p className="privacy-note">Esta acción retira la card y su ficha pública. No borra físicamente datos humanitarios, reportes ni auditoría.</p>
    {!canWithdraw && <p className="privacy-note">Solo un administrador puede retirar personas; los moderadores tienen acceso de consulta.</p>}
    <form className="search-form" onSubmit={search}>
      <label>Buscar por nombre o lugar<input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={140} /></label>
      <button className="button" type="submit">Buscar</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {success && <p className="success" role="status">{success}</p>}
    {loading ? <p role="status">Cargando personas administradas…</p> : !people.length
      ? <p className="empty">No se encontraron personas.</p>
      : <div className="moderation-list">{people.map((item) => <article className="moderation-card" key={item.caseId}>
        <header>
          <div><h2>{item.fullName}</h2><p>{conditionLabels[item.conditionStatus] || item.conditionStatus} · {publicationLabels[item.publicationStatus] || item.publicationStatus}</p></div>
          {item.publicationStatus === "published" && <span className="reviewed-badge">Visible en el buscador</span>}
        </header>
        <dl>
          <div><dt>Edad</dt><dd>{item.approximateAge ?? "No informada"}</dd></div>
          <div><dt>Unidad o lugar público</dt><dd>{item.reportedUnit || item.publicLocation || "No informado"}</dd></div>
          <div><dt>Publicada</dt><dd>{formatDate(item.publishedAt)}</dd></div>
          {item.withdrawnAt && <div><dt>Retirada</dt><dd>{formatDate(item.withdrawnAt)}</dd></div>}
        </dl>
        {item.publicationStatus === "published" && <p><Link href={publicCasePath(item.slug)}>Abrir ficha pública</Link></p>}
        {canWithdraw && item.publicationStatus === "published" && <form className="report-form compact-form" onSubmit={(event) => withdraw(event, item)}>
          <label>Razón obligatoria del retiro<textarea name="reason" minLength={3} maxLength={1000} required /></label>
          <label className="check"><input type="checkbox" name="confirm" required /> Confirmo que esta persona debe dejar de aparecer públicamente.</label>
          <button className="button secondary" type="submit" disabled={busyId === item.caseId}>{busyId === item.caseId ? "Retirando…" : "Retirar del buscador"}</button>
        </form>}
      </article>)}</div>}
  </>;
}
