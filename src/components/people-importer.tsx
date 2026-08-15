"use client";

import { FormEvent, useState } from "react";
import type { PersonImportType } from "@/lib/person-import";

type PreviewItem = {
  row: number;
  sourceRow?: string | number | null;
  fullName: string;
  normalizedName: string;
  matchCount: number;
  existingCaseId: string | null;
  decision: "create" | "update" | "already_imported" | "review_required";
  reviewReason?: string | null;
};

const decisionLabel = {
  create: "Crear",
  update: "Actualizar",
  already_imported: "Ya importado; se omitirá",
  review_required: "Revisión manual"
};

function defaults(type: PersonImportType) {
  return type === "missing" ? {
    sourceName: "Lista aportada por administrador",
    sourceReference: "Lista de desaparecidos aportada por administrador - 2026-08-15",
    publicDescription: "Persona reportada como desaparecida en lista aportada por administrador."
  } : {
    sourceName: "Medicina Legal",
    sourceReference: "",
    publicDescription: "Información tomada de las listas de Medicina Legal."
  };
}

export function PeopleImporter({
  initialType = "missing",
  lockType = false
}: {
  initialType?: PersonImportType;
  lockType?: boolean;
}) {
  const initialDefaults = defaults(initialType);
  const [importType, setImportType] = useState<PersonImportType>(initialType);
  const [verificationLevel, setVerificationLevel] = useState<"moderator_reviewed" | "authority_confirmed">(
    initialType === "deceased" ? "authority_confirmed" : "moderator_reviewed"
  );
  const [sourceName, setSourceName] = useState(initialDefaults.sourceName);
  const [sourceReference, setSourceReference] = useState(initialDefaults.sourceReference);
  const [publicDescription, setPublicDescription] = useState(initialDefaults.publicDescription);
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [previewToken, setPreviewToken] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  function invalidatePreview() {
    setPreview([]);
    setPreviewToken("");
    setResult("");
  }

  function changeType(nextType: PersonImportType) {
    const nextDefaults = defaults(nextType);
    setImportType(nextType);
    setVerificationLevel(nextType === "deceased" ? "authority_confirmed" : "moderator_reviewed");
    setSourceName(nextDefaults.sourceName);
    setSourceReference(nextDefaults.sourceReference);
    setPublicDescription(nextDefaults.publicDescription);
    setFile(null);
    setPastedText("");
    invalidatePreview();
  }

  function formData(mode: "preview" | "confirm", reason = "", confirmedOfficialSource = false) {
    const data = new FormData();
    data.set("importType", importType);
    data.set("verificationLevel", importType === "deceased" ? "authority_confirmed" : verificationLevel);
    data.set("sourceName", sourceName);
    data.set("sourceReference", sourceReference);
    data.set("defaultPublicDescription", publicDescription);
    data.set("mode", mode);
    data.set("reason", reason);
    data.set("confirmedOfficialSource", String(confirmedOfficialSource));
    data.set("previewToken", previewToken);
    if (file) data.set("file", file);
    else data.set("pastedText", pastedText);
    return data;
  }

  async function call(mode: "preview" | "confirm", reason = "", confirmedOfficialSource = false) {
    setBusy(true);
    setError("");
    setResult("");
    const response = await fetch("/api/admin/import-people", {
      method: "POST",
      body: formData(mode, reason, confirmedOfficialSource)
    });
    const data = await response.json().catch(() => null) as {
      message?: string;
      preview?: PreviewItem[];
      previewToken?: string;
      result?: { created?: number; updated?: number; skipped?: number; published?: number; pendingReview?: number; total?: number };
    } | null;
    setBusy(false);
    if (!response.ok) {
      setError(data?.message || "No fue posible procesar la importación.");
      return;
    }
    if (mode === "preview") {
      setPreview(data?.preview || []);
      setPreviewToken(data?.previewToken || "");
      return;
    }
    setPreview([]);
    setPreviewToken("");
    const imported = data?.result;
    setResult(`Importación completada: ${imported?.created || 0} creados, ${imported?.updated || 0} actualizados, ${imported?.skipped || 0} omitidos por idempotencia, ${imported?.published || 0} publicados y ${imported?.pendingReview || 0} pendientes de revisión.`);
  }

  async function previewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await call("preview");
  }

  async function confirmSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await call(
      "confirm",
      String(values.get("reason") || ""),
      values.get("confirmedOfficialSource") === "on"
    );
  }

  const official = importType === "deceased" || verificationLevel === "authority_confirmed";
  const blocked = preview.some((item) => item.decision === "review_required");

  return <div className="importer">
    <form className="report-form" onSubmit={previewSubmit}>
      {!lockType && <label>Tipo de lista
        <select value={importType} onChange={(event) => changeType(event.target.value as PersonImportType)}>
          <option value="missing">Desaparecidos</option>
          <option value="deceased">Fallecidos confirmados</option>
        </select>
      </label>}
      {importType === "missing" && <label>Nivel de verificación
        <select value={verificationLevel} onChange={(event) => { setVerificationLevel(event.target.value as typeof verificationLevel); invalidatePreview(); }}>
          <option value="moderator_reviewed">Revisado por moderación</option>
          <option value="authority_confirmed">Fuente oficial</option>
        </select>
      </label>}
      <label>Nombre de la fuente
        <input value={sourceName} onChange={(event) => { setSourceName(event.target.value); invalidatePreview(); }} required maxLength={160} readOnly={importType === "deceased"} />
      </label>
      <label>Referencia privada de la fuente
        <input value={sourceReference} onChange={(event) => { setSourceReference(event.target.value); invalidatePreview(); }} required maxLength={500} autoComplete="off" />
      </label>
      <label>Descripción pública predeterminada
        <textarea value={publicDescription} onChange={(event) => { setPublicDescription(event.target.value); invalidatePreview(); }} maxLength={800} />
      </label>
      <label>Archivo CSV o Excel
        <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => {
          setFile(event.target.files?.[0] || null);
          if (event.target.files?.[0]) setPastedText("");
          invalidatePreview();
        }} />
      </label>
      <label>O pega una tabla CSV/TSV
        <textarea value={pastedText} onChange={(event) => { setPastedText(event.target.value); if (event.target.value) setFile(null); invalidatePreview(); }} rows={10} />
      </label>
      <p className="privacy-note">Los campos opcionales vacíos permanecen vacíos. No se crean edades, sexo, municipio, departamento ni fotos.</p>
      <button className="button" disabled={busy || (!file && !pastedText.trim())}>{busy ? "Validando…" : "Generar vista previa"}</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {result && <p className="success" role="status">{result}</p>}
    {preview.length > 0 && <section className="import-preview">
      <h2>Vista previa</h2>
      <div className="table-scroll"><table><thead><tr><th>Fila</th><th>Fila fuente</th><th>Nombre</th><th>Coincidencias</th><th>Decisión</th></tr></thead><tbody>{preview.map((item) => <tr key={`${item.row}-${item.fullName}`}><td>{item.row}</td><td>{item.sourceRow || "—"}</td><td>{item.fullName}</td><td>{item.matchCount}</td><td>{decisionLabel[item.decision]}{item.reviewReason ? ` · ${item.reviewReason}` : ""}</td></tr>)}</tbody></table></div>
      {blocked ? <p className="form-error">Hay homónimos o coincidencias ambiguas. Resuelve esas filas manualmente antes de importar.</p> : <form className="report-form" onSubmit={confirmSubmit}>
        <label>Razón de importación<textarea name="reason" required minLength={10} maxLength={1000} /></label>
        {official && <label className="check"><input type="checkbox" name="confirmedOfficialSource" required /> Confirmo que revisé esta lista contra una fuente oficial.</label>}
        {!official && <p className="privacy-note">Esta lista no oficial se guardará en revisión pendiente y no aparecerá públicamente.</p>}
        <button className="button danger-button" disabled={busy}>{busy ? "Importando…" : "Confirmar importación"}</button>
      </form>}
    </section>}
  </div>;
}
