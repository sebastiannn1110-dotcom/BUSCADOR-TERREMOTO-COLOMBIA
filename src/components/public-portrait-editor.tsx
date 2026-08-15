"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { PhotoPlaceholder } from "@/components/photo-placeholder";

export function PublicPortraitEditor({
  caseId,
  fullName,
  currentPhotoUrl,
  onUpdated
}: {
  caseId: string;
  fullName: string;
  currentPhotoUrl: string | null;
  onUpdated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get("file");
    if (!(file instanceof File) || !file.size) {
      setError("Selecciona una foto antes de continuar.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/admin/cases/${caseId}/portrait`, { method: "POST", body: values });
    const data = await response.json().catch(() => null) as { message?: string } | null;
    setBusy(false);
    if (!response.ok) {
      setError(data?.message || "No fue posible actualizar la foto.");
      return;
    }
    setMessage("Foto actualizada correctamente.");
    form.reset();
    await onUpdated();
  }

  async function remove() {
    const reasonInput = document.getElementById(`portrait-reason-${caseId}`) as HTMLInputElement | null;
    const reason = reasonInput?.value.trim() || "";
    if (reason.length < 3) {
      setError("Indica una razón interna antes de quitar la foto.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/admin/cases/${caseId}/portrait`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason })
    });
    const data = await response.json().catch(() => null) as { message?: string } | null;
    setBusy(false);
    if (!response.ok) {
      setError(data?.message || "No fue posible quitar la foto pública.");
      return;
    }
    setMessage("Foto pública eliminada correctamente.");
    await onUpdated();
  }

  return <section className="portrait-admin" aria-label={`Foto pública de ${fullName}`}>
    <h3>Foto pública</h3>
    <div className="admin-portrait-preview">
      {currentPhotoUrl
        ? <Image unoptimized src={currentPhotoUrl} alt={`Foto pública actual de ${fullName}`} width={180} height={180} />
        : <PhotoPlaceholder />}
    </div>
    <form className="report-form compact-form" onSubmit={upload}>
      <label>{currentPhotoUrl ? "Seleccionar nueva foto" : "Seleccionar foto"}
        <input name="file" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" required />
      </label>
      <label>Razón interna
        <input id={`portrait-reason-${caseId}`} name="reason" minLength={3} maxLength={1000} required />
      </label>
      <div className="moderation-actions">
        <button className="button" type="submit" disabled={busy}>{busy ? "Procesando…" : currentPhotoUrl ? "Cambiar foto" : "Subir foto"}</button>
        {currentPhotoUrl && <button className="button secondary" type="button" onClick={remove} disabled={busy}>Quitar foto pública</button>}
      </div>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="success" role="status">{message}</p>}
  </section>;
}
