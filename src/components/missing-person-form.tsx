"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Turnstile } from "@/components/turnstile";

type Draft = Record<string, string>;

export function MissingPersonForm() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const progressRef = useRef<HTMLParagraphElement>(null);
  const previousStep = useRef(step);
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

  useEffect(() => {
    if (previousStep.current !== step) progressRef.current?.focus();
    previousStep.current = step;
  }, [step]);

  function formStrings(form: HTMLFormElement) {
    return Object.fromEntries([...new FormData(form)].filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  }

  function saveStep(form: HTMLFormElement) {
    setDraft((current) => ({ ...current, ...formStrings(form) }));
  }

  function selectPhoto(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setError("La foto debe ser JPG, PNG o WebP y pesar máximo 8 MB.");
      return;
    }
    setError("");
    setPhoto(file);
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
    if (captchaPending) {
      setError("Completa la verificación de seguridad antes de enviar el reporte.");
      return;
    }

    const values: Draft = { ...draft, ...formStrings(form), captchaToken };
    if (!values.phone?.trim() && !values.email?.trim()) {
      setError("Escribe un celular o un correo para que podamos contactarte.");
      return;
    }
    const body = new FormData();
    Object.entries(values).forEach(([key, value]) => body.set(key, value));
    if (photo) body.set("photo", photo, photo.name);

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reports", { method: "POST", body });
      const data = await response.json().catch(() => null) as { message?: string; trackingCode?: string } | null;
      if (!response.ok || !data?.trackingCode) {
        setError(data?.message || "No pudimos enviar el reporte. Inténtalo de nuevo más tarde.");
        return;
      }
      router.push(`/reporte/confirmacion/${encodeURIComponent(data.trackingCode)}`);
    } catch {
      setError("No pudimos enviar el reporte. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <p className="steps" ref={progressRef} tabIndex={-1} aria-live="polite">Paso {step} de 3</p>
    <form className="report-form" onSubmit={submit} aria-busy={busy}>
      <input className="honeypot" aria-hidden="true" tabIndex={-1} name="website" autoComplete="off" />
      {step === 1 && <fieldset>
        <legend>¿A quién buscas?</legend>
        <label>Nombre completo<input name="fullName" required minLength={3} maxLength={140} autoCapitalize="words" defaultValue={draft.fullName || ""} /></label>
        <label>Alias o nombre por el que le conocen (opcional)<input name="alias" maxLength={120} defaultValue={draft.alias || ""} /></label>
        <label>Edad aproximada (opcional)<input name="approximateAge" type="number" inputMode="numeric" min="0" max="120" defaultValue={draft.approximateAge || ""} /></label>
        <fieldset className="choice-group">
          <legend>¿Es menor de edad?</legend>
          <label className="check"><input name="isMinor" type="radio" value="true" required defaultChecked={draft.isMinor === "true"} /> Sí</label>
          <label className="check"><input name="isMinor" type="radio" value="false" required defaultChecked={draft.isMinor === "false"} /> No</label>
        </fieldset>
        <div>
          <span className="field-label">Foto reciente (opcional)</span>
          <div className="upload-actions">
            <label className="button secondary file-button">Subir foto<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectPhoto(event.target.files?.[0])} /></label>
            <label className="button secondary file-button">Tomar foto<input className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => selectPhoto(event.target.files?.[0])} /></label>
          </div>
          <p className="hint">La foto ayuda a identificar a la persona. Si no tienes foto, puedes continuar. JPG, PNG o WebP, máximo 8 MB.</p>
          {photo && <p className="file-selected">Archivo seleccionado: {photo.name}</p>}
        </div>
        <label>Características distintivas (opcional)<textarea name="features" maxLength={800} defaultValue={draft.features || ""} /></label>
        <label>Ropa que llevaba (opcional)<textarea name="clothing" maxLength={800} defaultValue={draft.clothing || ""} /></label>
      </fieldset>}
      {step === 2 && <fieldset>
        <legend>Última vez que fue vista</legend>
        <label>Fecha aproximada<input name="lastSeenDate" type="date" required defaultValue={draft.lastSeenDate || ""} /></label>
        <label>Hora aproximada (opcional)<input name="lastSeenTime" type="time" defaultValue={draft.lastSeenTime || ""} /></label>
        <label>Lugar aproximado<input name="location" required minLength={3} maxLength={240} autoCapitalize="words" defaultValue={draft.location || ""} /></label>
        <label>Circunstancias<textarea name="circumstances" required minLength={10} maxLength={2000} defaultValue={draft.circumstances || ""} /></label>
      </fieldset>}
      {step === 3 && <fieldset>
        <legend>Tu contacto privado</legend>
        <label>Tu nombre<input name="reporterName" required minLength={2} maxLength={140} autoComplete="name" defaultValue={draft.reporterName || ""} /></label>
        <label>Celular (escribe celular o correo)<input name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} defaultValue={draft.phone || ""} /></label>
        <label>Correo (escribe celular o correo)<input name="email" type="email" autoComplete="email" maxLength={254} defaultValue={draft.email || ""} /></label>
        <label>Relación con la persona (opcional)<input name="relationship" maxLength={120} defaultValue={draft.relationship || ""} /></label>
        <p className="privacy-note">Estos datos son privados y solo se usan para revisar el reporte o solicitar información adicional.</p>
        <label className="check"><input name="consent" type="checkbox" required /> Autorizo el tratamiento de esta información para localizar a la persona y revisar el reporte.</label>
      </fieldset>}
      {step === 3 && captchaEnabled && <>
        <Turnstile siteKey={captchaSiteKey} onToken={onCaptchaToken} onError={onCaptchaError} />
        {captchaPending && <p id="captcha-submit-help" className="hint" role="status">Completa la verificación de seguridad para habilitar el envío.</p>}
        {captchaError && <p className="form-error" role="alert">{captchaError}</p>}
      </>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="form-actions">
        {step > 1 && <button type="button" className="button secondary" onClick={(event) => { if (event.currentTarget.form) saveStep(event.currentTarget.form); setError(""); setStep((current) => current - 1); }}>Atrás</button>}
        <button className="button" type="submit" disabled={busy || (step === 3 && captchaPending)} aria-describedby={step === 3 && captchaPending ? "captcha-submit-help" : undefined}>{step === 3 ? busy ? "Enviando…" : "Enviar para revisión" : "Continuar"}</button>
      </div>
    </form>
  </>;
}
