"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type EvidenceAsset = {
  id: string;
  assetType?: string | null;
  mimeType?: string | null;
  detectedMimeType?: string | null;
  sizeBytes?: number | null;
  originalFilename?: string | null;
};

type PendingPersonCase = {
  id?: string;
  caseId?: string;
  slug?: string | null;
  fullName: string;
  approximateAge: number | null;
  isMinor?: boolean;
  lastSeenAt: string | null;
  locationPrivate: string | null;
  descriptionPrivate?: string | null;
  publicDescription?: string | null;
  distinguishingFeatures?: string | null;
  clothing?: string | null;
  trackingCode: string | null;
  createdAt: string;
  reporterName: string | null;
  phone: string | null;
  email?: string | null;
  publicationStatus?: string | null;
  evidenceAssets?: EvidenceAsset[];
};

const reviewActions = [
  ["publish", "Publicar como desaparecido"],
  ["reject", "Rechazar"],
  ["duplicate", "Marcar duplicado"],
  ["request_information", "Solicitar más información"],
  ["archive", "Archivar"]
] as const;

function caseId(item: PendingPersonCase) {
  return item.caseId || item.id || "";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "No informada";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function assetMime(asset: EvidenceAsset) {
  return asset.mimeType || asset.detectedMimeType || "";
}

export function PendingPeopleQueue() {
  const [cases, setCases] = useState<PendingPersonCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const response = await fetch("/api/admin/pending-people", { cache: "no-store" });
    const data = await response.json().catch(() => null) as { cases?: PendingPersonCase[]; message?: string } | null;
    setLoading(false);
    if (!response.ok) {
      setError(data?.message || "No fue posible cargar las personas pendientes.");
      return;
    }
    setCases(data?.cases || []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function review(event: FormEvent<HTMLFormElement>, item: PendingPersonCase) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const action = submitter?.value || "";
    const values = new FormData(event.currentTarget);
    const id = caseId(item);
    const publicLocation = String(values.get("publicLocation") || "").trim();
    if (action === "publish" && !publicLocation) {
      setError("Para publicar, escribe un lugar público aproximado.");
      return;
    }
    const approvePhoto = action === "publish" && values.get("approvePhoto") === "on";
    setBusyId(id);
    setError("");
    const response = await fetch("/api/admin/pending-people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: id,
        action,
        reason: values.get("reason"),
        publicDescription: action === "publish" ? values.get("publicDescription") : undefined,
        publicLocation: action === "publish" ? publicLocation : undefined,
        approvePhoto,
        sourceMediaAssetId: approvePhoto ? values.get("sourceMediaAssetId") : undefined
      })
    });
    const data = await response.json().catch(() => null) as { message?: string } | null;
    setBusyId("");
    if (!response.ok) {
      setError(data?.message || "No fue posible revisar el caso.");
      return;
    }
    await load();
  }

  if (loading) return <p role="status">Cargando personas pendientes…</p>;

  return <>
    <nav className="moderation-actions" aria-label="Áreas administrativas">
      <Link href="/admin/avistamientos">Posibles avistamientos</Link>
      <Link href="/admin/seguimiento-contactos">Seguimiento de contactos</Link>
    </nav>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!cases.length ? <p className="empty">No hay personas pendientes de revisión.</p> : <div className="moderation-list">{cases.map((item) => {
      const id = caseId(item);
      const evidence = item.evidenceAssets || [];
      const imageEvidence = evidence.filter((asset) => assetMime(asset).startsWith("image/"));
      const identifyingDescription = item.descriptionPrivate || item.distinguishingFeatures;
      return <article className="moderation-card" key={id}>
        <header>
          <div><h2>{item.fullName}</h2><p>Estado de revisión: Pendiente</p></div>
          {item.isMinor && <span className="reviewed-badge">Privacidad reforzada: menor de edad</span>}
        </header>
        <dl>
          <div><dt>Edad aproximada</dt><dd>{item.approximateAge ?? "No informada"}</dd></div>
          <div><dt>Última vez vista</dt><dd>{formatDate(item.lastSeenAt)}</dd></div>
          <div><dt>Lugar privado aproximado</dt><dd>{item.locationPrivate || "No informado"}</dd></div>
          <div><dt>Descripción para identificarla</dt><dd>{identifyingDescription || "No informada"}</dd></div>
          {item.clothing && <div><dt>Ropa informada</dt><dd>{item.clothing}</dd></div>}
          <div><dt>Reportante</dt><dd>{item.reporterName || "No informado"}</dd></div>
          <div><dt>Número privado</dt><dd>{item.phone || "No informado"}</dd></div>
          {item.email && <div><dt>Correo privado</dt><dd>{item.email}</dd></div>}
          <div><dt>Código de seguimiento</dt><dd>{item.trackingCode || "No disponible"}</dd></div>
          <div><dt>Reporte creado</dt><dd>{formatDate(item.createdAt)}</dd></div>
        </dl>

        <section aria-label={`Evidencia privada de ${item.fullName}`}>
          <h3>Foto o evidencia privada</h3>
          {!evidence.length ? <p>No se adjuntó evidencia.</p> : <div className="moderation-actions">{evidence.map((asset) => <div key={asset.id}>
            {assetMime(asset).startsWith("image/")
              ? <Image unoptimized src={`/api/admin/private-media/${asset.id}`} alt="Evidencia privada; solo visible para personal autorizado" width={220} height={220} />
              : <a href={`/api/admin/private-media/${asset.id}`}>Abrir evidencia privada</a>}
            <small>{asset.originalFilename || asset.assetType || "Archivo adjunto"}{asset.sizeBytes ? ` · ${Math.ceil(asset.sizeBytes / 1024)} KB` : ""}</small>
          </div>)}</div>}
        </section>

        <form className="report-form compact-form" onSubmit={(event) => review(event, item)}>
          <fieldset>
            <legend>Editar campos públicos antes de publicar</legend>
            <p className="privacy-note">Escribe una versión nueva y aproximada. Los campos privados no se copian automáticamente.</p>
            <label>Lugar público aproximado (obligatorio al publicar)<input name="publicLocation" defaultValue="" maxLength={240} autoComplete="off" /></label>
            <label>Descripción pública revisada<textarea name="publicDescription" defaultValue="" maxLength={800} /></label>
            {imageEvidence.length > 0 && <>
              <label>Foto candidata<select name="sourceMediaAssetId" defaultValue={imageEvidence[0]?.id}>{imageEvidence.map((asset, index) => <option key={asset.id} value={asset.id}>Evidencia {index + 1}{asset.originalFilename ? ` · ${asset.originalFilename}` : ""}</option>)}</select></label>
              <label className="check"><input type="checkbox" name="approvePhoto" /> Aprobar esta foto como retrato público</label>
            </>}
          </fieldset>
          <label>Razón interna de la acción<textarea name="reason" minLength={3} maxLength={1000} required /></label>
          <div className="moderation-actions">{reviewActions.map(([value, label]) => <button className={value === "publish" ? "button" : "button secondary"} type="submit" name="action" value={value} key={value} disabled={busyId === id}>{busyId === id ? "Guardando…" : label}</button>)}</div>
        </form>
        <p><Link href={`/admin/seguimiento-contactos?caseId=${encodeURIComponent(id)}`}>Registrar contacto con el reportante</Link></p>
      </article>;
    })}</div>}
  </>;
}
