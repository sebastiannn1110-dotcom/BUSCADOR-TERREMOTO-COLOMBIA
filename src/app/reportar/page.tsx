"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Turnstile } from "@/components/turnstile";

type Draft = Record<string, FormDataEntryValue>;
type Submission = { trackingCode?: string };

export default function ReportPage() {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>({});
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const progressRef = useRef<HTMLParagraphElement>(null);
  const previousStep = useRef(step);
  const captchaSiteKey = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY || "";
  const captchaRequired = process.env.NODE_ENV === "production";
  const captchaUnavailable = captchaRequired && !captchaSiteKey;
  const captchaPending = captchaRequired && Boolean(captchaSiteKey) && !captchaToken;
  const onCaptchaError = useCallback(() => {
    setCaptchaToken("");
    setCaptchaError("No se pudo completar la verificación. Recarga la página e inténtalo de nuevo.");
  }, []);
  const onCaptchaToken = useCallback((token: string) => {
    setCaptchaToken(token);
    setCaptchaError("");
  }, []);

  useEffect(() => {
    if (previousStep.current !== step) {
      progressRef.current?.focus();
      previousStep.current = step;
    }
  }, [step]);

  function saveStep(form: HTMLFormElement) {
    setDraft((current) => ({ ...current, ...Object.fromEntries(new FormData(form)) }));
  }

  function goBack(form: HTMLFormElement | null) {
    if (form) saveStep(form);
    setError("");
    setStep((current) => Math.max(1, current - 1));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (step < 3) {
      saveStep(form);
      setError("");
      setStep((current) => current + 1);
      return;
    }

    setBusy(true);
    setError("");

    try {
      if (captchaRequired && !captchaToken) {
        setError("Completa la verificación de seguridad antes de enviar el reporte.");
        return;
      }
      const body: Record<string, unknown> = { ...draft, ...Object.fromEntries(new FormData(form)), captchaToken };
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => null) as { message?: string; trackingCode?: string } | null;

      if (!response.ok) {
        setError(data?.message || "No pudimos enviar el reporte. Inténtalo de nuevo más tarde.");
        return;
      }

      setSubmission({ trackingCode: data?.trackingCode });
    } catch {
      setError("No pudimos enviar el reporte. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  if (submission) return <section className="form-page"><div className="success" role="status" aria-live="polite"><h1>Reporte recibido</h1>{submission.trackingCode && <p>Tu código de seguimiento es <strong>{submission.trackingCode}</strong>.</p>}<p>El caso no se publica automáticamente. Un equipo revisará la información y podrá contactarte.</p></div></section>;

  return <section className="form-page">
    <h1>Reportar a una persona desaparecida</h1>
    <p className="lead">Completa lo que sepas. Tu celular se mantiene privado.</p>
    <p className="steps" ref={progressRef} tabIndex={-1} aria-live="polite">Paso {step} de 3</p>
    <form className="report-form" onSubmit={submit} aria-busy={busy}>
      <input className="honeypot" aria-hidden="true" tabIndex={-1} name="website" autoComplete="off" />
      {step === 1 && <fieldset>
        <legend>¿A quién buscas?</legend>
        <label>Nombre completo<input name="fullName" required minLength={3} maxLength={140} autoCapitalize="words" defaultValue={String(draft.fullName || "")} /></label>
        <label>Edad aproximada<input name="approximateAge" type="number" inputMode="numeric" min="0" max="120" defaultValue={String(draft.approximateAge || "")} /></label>
      </fieldset>}
      {step === 2 && <fieldset>
        <legend>Última vez que fue vista</legend>
        <label>Fecha<input name="lastSeenDate" type="date" required defaultValue={String(draft.lastSeenDate || "")} /></label>
        <label>Hora aproximada<input name="lastSeenTime" type="time" defaultValue={String(draft.lastSeenTime || "")} /></label>
        <label>Lugar aproximado<input name="location" required maxLength={240} autoCapitalize="words" defaultValue={String(draft.location || "")} /></label>
        <label>Ropa que llevaba<textarea name="clothing" maxLength={800} defaultValue={String(draft.clothing || "")} /></label>
        <label>Características distintivas<textarea name="features" maxLength={800} defaultValue={String(draft.features || "")} /></label>
      </fieldset>}
      {step === 3 && <fieldset>
        <legend>Contacto</legend>
        <label>Tu nombre (privado)<input name="reporterName" required maxLength={140} autoComplete="name" autoCapitalize="words" defaultValue={String(draft.reporterName || "")} /></label>
        <label>Número de celular (privado)<input name="phone" type="tel" inputMode="tel" autoComplete="tel" required minLength={7} maxLength={40} aria-describedby="phone-help" defaultValue={String(draft.phone || "")} /></label>
        <p id="phone-help" className="privacy-note">Usaremos este número solamente para revisar el reporte o pedir información adicional.</p>
      </fieldset>}
      {error && <p role="alert" className="form-error">{error}</p>}
      {step === 3 && captchaRequired && <>
        {captchaSiteKey ? <Turnstile siteKey={captchaSiteKey} onToken={onCaptchaToken} onError={onCaptchaError} /> : <p id="captcha-submit-help" className="form-error" role="status">El envío seguro no está disponible en este momento. Inténtalo más tarde.</p>}
        {captchaPending && <p id="captcha-submit-help" className="hint" role="status">Completa la verificación de seguridad para habilitar el envío.</p>}
        {captchaError && <p className="form-error" role="alert">{captchaError}</p>}
      </>}
      <div className="form-actions">
        {step > 1 && <button type="button" className="button secondary" onClick={(event) => goBack(event.currentTarget.form)}>Atrás</button>}
        <button className="button" type="submit" disabled={busy || (step === 3 && (captchaUnavailable || captchaPending))} aria-describedby={step === 3 && (captchaUnavailable || captchaPending) ? "captcha-submit-help" : undefined}>{step === 3 ? (busy ? "Enviando…" : "Enviar reporte") : "Continuar"}</button>
      </div>
    </form>
  </section>;
}
