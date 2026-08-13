"use client";

import { FormEvent, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Turnstile } from "@/components/turnstile";

const options = [
  ["sighting", "Creo que la vi."],
  ["possible_trapped", "Puede estar atrapada."],
  ["possible_deceased", "Tengo información sobre un posible fallecimiento."],
  ["correction", "Quiero corregir un dato."],
  ["other_information", "Tengo otra información."]
];

export function InformationForm({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [reportType, setReportType] = useState("sighting");
  const [evidence, setEvidence] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const captchaSiteKey = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY || "";
  const captchaEnabled = Boolean(captchaSiteKey);
  const captchaPending = captchaEnabled && !captchaToken;
  const urgent = reportType === "possible_trapped" || reportType === "possible_deceased";
  const onCaptchaError = useCallback(() => { setCaptchaToken(""); setCaptchaError("No se pudo completar la verificación. Recarga la página e inténtalo de nuevo."); }, []);
  const onCaptchaToken = useCallback((token: string) => { setCaptchaToken(token); setCaptchaError(""); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (captchaPending) {
      setError("Completa la verificación de seguridad antes de enviar la información.");
      return;
    }
    const body = new FormData(event.currentTarget);
    if (urgent && !String(body.get("phone") || "").trim() && !String(body.get("email") || "").trim()) {
      setError("La información urgente requiere un celular o un correo de contacto.");
      return;
    }
    body.set("caseId", caseId);
    body.set("captchaToken", captchaToken);
    if (evidence) body.set("photo", evidence, evidence.name);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reports", { method: "POST", body });
      const data = await response.json().catch(() => null) as { message?: string; trackingCode?: string } | null;
      if (!response.ok || !data?.trackingCode) {
        setError(data?.message || "No pudimos enviar la información. Inténtalo de nuevo más tarde.");
        return;
      }
      router.push(`/reporte/confirmacion/${encodeURIComponent(data.trackingCode)}`);
    } catch {
      setError("No pudimos enviar la información. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  function selectEvidence(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setError("La evidencia debe ser JPG, PNG o WebP y pesar máximo 8 MB.");
      return;
    }
    setError("");
    setEvidence(file);
  }

  return <form onSubmit={submit} className="report-form" aria-busy={busy}>
    <input className="honeypot" aria-hidden="true" tabIndex={-1} name="website" autoComplete="off" />
    <label>Tipo de información<select name="reportType" value={reportType} onChange={(event) => setReportType(event.target.value)}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {urgent && <p className="urgent-note" role="status">Este tipo de información se prioriza. Necesitamos un celular o correo para que el equipo pueda contactarte.</p>}
    <label>Fecha aproximada<input name="eventDate" type="date" /></label>
    <label>Hora aproximada<input name="eventTime" type="time" /></label>
    <label>Lugar aproximado<input name="location" maxLength={240} autoCapitalize="words" /></label>
    <label>Descripción<textarea name="description" required minLength={10} maxLength={3000} /></label>
    <label className="button secondary file-button">Adjuntar evidencia (opcional)<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectEvidence(event.target.files?.[0])} /></label>
    {evidence && <p className="file-selected">Archivo seleccionado: {evidence.name}</p>}
    <fieldset>
      <legend>Contacto privado (opcional, obligatorio para información urgente)</legend>
      <label>Tu nombre<input name="reporterName" maxLength={140} autoComplete="name" /></label>
      <label>Celular<input name="phone" type="tel" maxLength={40} autoComplete="tel" /></label>
      <label>Correo<input name="email" type="email" maxLength={254} autoComplete="email" /></label>
      <label>Relación con la persona<input name="relationship" maxLength={120} /></label>
    </fieldset>
    <p className="privacy-note">La evidencia y el contacto son privados. La información se publica únicamente después de revisión humana.</p>
    <label className="check"><input name="consent" type="checkbox" required /> Autorizo el tratamiento de esta información para su revisión.</label>
    {captchaEnabled && <>
      <Turnstile siteKey={captchaSiteKey} onToken={onCaptchaToken} onError={onCaptchaError} />
      {captchaPending && <p id="captcha-submit-help" className="hint" role="status">Completa la verificación de seguridad para habilitar el envío.</p>}
      {captchaError && <p className="form-error" role="alert">{captchaError}</p>}
    </>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <button className="button" type="submit" disabled={busy || captchaPending} aria-describedby={captchaPending ? "captcha-submit-help" : undefined}>{busy ? "Enviando…" : "Enviar información"}</button>
  </form>;
}
