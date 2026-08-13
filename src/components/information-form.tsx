"use client";

import { FormEvent, useCallback, useState } from "react";
import { Turnstile } from "@/components/turnstile";

const options = [
  ["sighting", "Creo que la vi."],
  ["possible_trapped", "Puede estar atrapada."],
  ["possible_deceased", "Tengo información sobre un posible fallecimiento."],
  ["correction", "Quiero corregir un dato."],
  ["other_information", "Tengo otra información."]
];

type Submission = { trackingCode?: string };

export function InformationForm({ caseId }: { caseId: string }) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const captchaSiteKey = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY || "";
  const captchaEnabled = Boolean(captchaSiteKey);
  const captchaPending = captchaEnabled && !captchaToken;
  const onCaptchaError = useCallback(() => {
    setCaptchaToken("");
    setCaptchaError("No se pudo completar la verificación. Recarga la página e inténtalo de nuevo.");
  }, []);
  const onCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
    setCaptchaError("");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (captchaEnabled && !captchaToken) {
      setError("Completa la verificación de seguridad antes de enviar la información.");
      return;
    }

    const body = {
      caseId,
      reportType: data.get("reportType"),
      eventAt: data.get("eventAt"),
      location: data.get("location"),
      description: data.get("description"),
      consent: data.get("consent") === "on",
      captchaToken,
      website: data.get("website")
    };

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const responseData = await response.json().catch(() => null) as { message?: string; trackingCode?: string } | null;

      if (!response.ok) {
        setError(responseData?.message || "No pudimos enviar la información. Inténtalo de nuevo más tarde.");
        return;
      }

      form.reset();
      setSubmission({ trackingCode: responseData?.trackingCode });
    } catch {
      setError("No pudimos enviar la información. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  if (submission) return <div className="success" role="status" aria-live="polite"><h3>Información recibida</h3>{submission.trackingCode && <p>Tu código de seguimiento es <strong>{submission.trackingCode}</strong>. Un equipo autorizado la revisará.</p>}<p>No cambia el estado del caso automáticamente.</p></div>;

  return <form onSubmit={submit} className="report-form" aria-busy={busy}>
    <input className="honeypot" aria-hidden="true" tabIndex={-1} name="website" autoComplete="off" />
    <label>Tipo de información<select name="reportType" defaultValue="sighting">{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>Fecha y hora aproximada<input name="eventAt" type="datetime-local" /></label>
    <label>Lugar aproximado<input name="location" maxLength={240} autoCapitalize="words" /></label>
    <label>Descripción<textarea name="description" required minLength={10} maxLength={3000} /></label>
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
