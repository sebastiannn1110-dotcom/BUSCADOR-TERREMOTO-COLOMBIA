"use client";

import { FormEvent, useState } from "react";

type PreviewItem = {
  row: number;
  fullName: string;
  normalizedName: string;
  matchCount: number;
  existingCaseId: string | null;
  decision: "create" | "update" | "already_imported" | "review_required";
};

const decisionLabel = {
  create: "Crear",
  update: "Actualizar",
  already_imported: "Ya importado; se omitirá",
  review_required: "Revisión manual"
};

export function OfficialDeceasedImporter() {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [previewToken, setPreviewToken] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  function updateCsv(value: string) {
    setCsv(value);
    setPreview([]);
    setPreviewToken("");
    setResult("");
  }

  async function call(mode: "preview" | "confirm", reason = "", confirmedOfficialSource = false) {
    setBusy(true);
    setError("");
    setResult("");
    const response = await fetch("/api/admin/import-deceased", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv, mode, reason, confirmedOfficialSource, previewToken })
    });
    const data = await response.json().catch(() => null) as { message?: string; preview?: PreviewItem[]; previewToken?: string; result?: { created: number; updated: number; skipped?: number; total: number } } | null;
    setBusy(false);
    if (!response.ok) { setError(data?.message || "No fue posible procesar la importación."); return; }
    if (mode === "preview") {
      setPreview(data?.preview || []);
      setPreviewToken(data?.previewToken || "");
    }
    else {
      setPreview([]);
      setPreviewToken("");
      setResult(`Importación completada: ${data?.result?.created || 0} creados, ${data?.result?.updated || 0} actualizados, ${data?.result?.skipped || 0} ya importados omitidos, ${data?.result?.total || 0} total.`);
    }
  }

  async function previewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await call("preview");
  }

  async function confirmSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const reason = String(values.get("reason") || "");
    await call("confirm", reason, values.get("confirmedOfficialSource") === "on");
  }

  return <div className="importer">
    <p className="privacy-note"><strong>Solo importe registros revisados contra una fuente oficial. No importe datos desde capturas ilegibles, cadenas de WhatsApp o mensajes reenviados.</strong></p>
    <form className="report-form" onSubmit={previewSubmit}>
      <label>Archivo CSV<input type="file" accept=".csv,text/csv" onChange={async (event) => updateCsv(event.target.files?.[0] ? await event.target.files[0].text() : "")} /></label>
      <label>O pega el CSV<textarea value={csv} onChange={(event) => updateCsv(event.target.value)} required rows={10} /></label>
      <button className="button" disabled={busy || !csv}>{busy ? "Validando…" : "Generar vista previa"}</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {result && <p className="success" role="status">{result}</p>}
    {preview.length > 0 && <section className="import-preview">
      <h2>Vista previa</h2>
      <div className="table-scroll"><table><thead><tr><th>Fila</th><th>Nombre</th><th>Coincidencias</th><th>Decisión</th></tr></thead><tbody>{preview.map((item) => <tr key={`${item.row}-${item.fullName}`}><td>{item.row}</td><td>{item.fullName}</td><td>{item.matchCount}</td><td>{decisionLabel[item.decision]}</td></tr>)}</tbody></table></div>
      {preview.some((item) => item.decision === "review_required") ? <p className="form-error">Hay coincidencias ambiguas. Corrige el archivo o resuélvelas manualmente antes de importar.</p> : <form className="report-form" onSubmit={confirmSubmit}>
        <label>Razón de importación<textarea name="reason" required minLength={10} maxLength={1000} /></label>
        <label className="check"><input type="checkbox" name="confirmedOfficialSource" required /> Confirmo que revisé esta información contra una fuente oficial.</label>
        <button className="button danger-button" disabled={busy}>{busy ? "Importando…" : "Confirmar importación oficial"}</button>
      </form>}
    </section>}
  </div>;
}
