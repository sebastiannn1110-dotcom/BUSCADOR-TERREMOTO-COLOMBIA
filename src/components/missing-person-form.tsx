"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Turnstile } from "@/components/turnstile";

type Draft = Record<string, string>;

const supportedPhotoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function normalizedPhoto(file: File) {
  if (supportedPhotoTypes.has(file.type)) return file;
  const extension = file.name.toLocaleLowerCase("es").match(/\.([a-z0-9]+)$/)?.[1];
  const inferredType = extension === "jpg" || extension === "jpeg"
    ? "image/jpeg"
    : extension === "png"
      ? "image/png"
      : extension === "webp"
        ? "image/webp"
        : null;
  if (inferredType && (!file.type || file.type === "application/octet-stream" || file.type === "image/jpg")) {
    return new File([file], file.name, { type: inferredType, lastModified: file.lastModified });
  }
  return null;
}

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
    const compatiblePhoto = normalizedPhoto(file);
    if (!compatiblePhoto || file.size > 8 * 1024 * 1024) {
      setPhoto(null);
      setError("La foto debe ser JPG, PNG o WebP y pesar máximo 8 MB. Si está en formato HEIC, conviértela o compártela como JPG.");
      return;
    }
    setError("");
    setPhoto(compatiblePhoto);
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
    const body = new FormData();
    Object.entries(values).forEach(([key, value]) => body.set(key, value));
    if (photo) body.set("photo", photo, photo.name);

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reports", { method: "POST", body });
      const data = await response.json().catch(() => null) as { message?: string; received?: boolean } | null;
      if (!response.ok || data?.received !== true) {
        setError(data?.message || "No pudimos enviar el reporte. Inténtalo de nuevo más tarde.");
        return;
      }
      router.push("/reporte/confirmacion");
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
        <label>Edad aproximada (opcional)<input name="approximateAge" type="number" inputMode="numeric" min="0" max="120" defaultValue={draft.approximateAge || ""} /></label>
        <div>
          <span className="field-label" id="photo-label">Foto reciente (opcional)</span>
          <p className="hint" id="photo-help">Formatos compatibles: JPG, PNG o WebP. Máximo 8 MB.</p>
          <div className="upload-actions">
            <input id="missing-person-photo" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-labelledby="photo-label" aria-describedby="photo-help" onChange={(event) => selectPhoto(event.target.files?.[0])} />
            <label className="button secondary file-button" htmlFor="missing-person-photo">Subir foto</label>
            <input id="missing-person-camera" className="sr-only" type="file" accept="image/*" capture="environment" aria-label="Tomar foto con la cámara" aria-describedby="photo-help" onChange={(event) => selectPhoto(event.target.files?.[0])} />
            <label className="button secondary file-button" htmlFor="missing-person-camera">Tomar foto</label>
          </div>
          <p className="hint">La foto ayuda a identificar a la persona. Si no tienes una compatible, puedes continuar sin foto.</p>
          {photo && <p className="file-selected">Archivo seleccionado: {photo.name}</p>}
        </div>
        <label>Descripción para identificarla (opcional)
          <textarea name="identificationDescription" maxLength={800} defaultValue={draft.identificationDescription || ""} />
          <span className="hint">Ejemplo: ropa, señales particulares, color de cabello, cicatrices, bolso, gorra u otro detalle útil.</span>
        </label>
      </fieldset>}

      {step === 2 && <fieldset>
        <legend>Última vez vista</legend>
        <label>Fecha aproximada<input name="lastSeenDate" type="date" required defaultValue={draft.lastSeenDate || ""} /></label>
        <label>Hora aproximada (opcional)<input name="lastSeenTime" type="time" defaultValue={draft.lastSeenTime || ""} /></label>
        <label>Lugar aproximado<input name="location" required minLength={3} maxLength={240} autoCapitalize="words" defaultValue={draft.location || ""} /></label>
      </fieldset>}

      {step === 3 && <fieldset>
        <legend>Contacto para revisión</legend>
        <label>Tu nombre<input name="reporterName" required minLength={2} maxLength={140} autoComplete="name" defaultValue={draft.reporterName || ""} /></label>
        <label>Número para contactarte<input name="phone" required type="tel" inputMode="tel" autoComplete="tel" minLength={7} maxLength={40} defaultValue={draft.phone || ""} /></label>
        <label className="check"><input name="consent" type="checkbox" required /> Confirmo que esta información es de buena fe y autorizo que sea revisada por el equipo.</label>
      </fieldset>}

      {step === 3 && captchaEnabled && <>
        <Turnstile siteKey={captchaSiteKey} onToken={onCaptchaToken} onError={onCaptchaError} />
        {captchaPending && <p id="captcha-submit-help" className="hint" role="status">Completa la verificación de seguridad para habilitar el envío.</p>}
        {captchaError && <p className="form-error" role="alert">{captchaError}</p>}
      </>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="form-actions">
        {step > 1 && <button type="button" className="button secondary" onClick={(event) => {
          if (event.currentTarget.form) saveStep(event.currentTarget.form);
          setError("");
          setStep((current) => current - 1);
        }}>Atrás</button>}
        <button className="button" type="submit" disabled={busy || (step === 3 && captchaPending)} aria-describedby={step === 3 && captchaPending ? "captcha-submit-help" : undefined}>
          {step === 3 ? busy ? "Enviando…" : "Enviar para revisión" : "Continuar"}
        </button>
      </div>
    </form>
  </>;
}
