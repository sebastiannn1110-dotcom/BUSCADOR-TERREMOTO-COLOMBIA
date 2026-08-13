"use client";

import { FormEvent, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Turnstile } from "@/components/turnstile";
import type { ReportContext, ReportType } from "@/lib/types";

export type InformationKind = "sighting_alive" | "sighting_care" | "possible_trapped" | "possible_deceased" | "correction" | "other_information";

type InformationOption = {
  kind: InformationKind;
  label: string;
  reportType: ReportType;
  reportContext?: ReportContext;
};

const options: InformationOption[] = [
  { kind: "sighting_alive", label: "La vi con vida", reportType: "sighting", reportContext: "sighting_alive" },
  { kind: "sighting_care", label: "Está en un hospital, refugio o punto de atención", reportType: "sighting", reportContext: "sighting_care" },
  { kind: "possible_trapped", label: "Podría estar atrapada", reportType: "possible_trapped" },
  { kind: "possible_deceased", label: "Tengo información sobre un posible fallecimiento", reportType: "possible_deceased" },
  { kind: "correction", label: "Quiero corregir un dato", reportType: "correction" },
  { kind: "other_information", label: "Otra información", reportType: "other_information" }
];

export function InformationForm({ caseId, initialKind = "sighting_alive" }: { caseId: string; initialKind?: InformationKind }) {
  const router = useRouter();
  const [kind, setKind] = useState<InformationKind>(initialKind);
  const [evidence, setEvidence] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const captchaSiteKey = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY || "";
  const captchaEnabled = Boolean(captchaSiteKey);
  const captchaPending = captchaEnabled && !captchaToken;
  const selected = options.find((option) => option.kind === kind) || options[0];
  const isSighting = selected.reportType === "sighting";
  const needsPhone = selected.reportContext === "sighting_care"
    || selected.reportType === "possible_trapped"
    || selected.reportType === "possible_deceased";

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
    if (captchaPending) {
      setError("Completa la verificación de seguridad antes de enviar la información.");
      return;
    }
    const body = new FormData(event.currentTarget);
    body.set("caseId", caseId);
    body.set("reportType", selected.reportType);
    if (selected.reportContext) body.set("reportContext", selected.reportContext);
    else body.delete("reportContext");
    body.set("captchaToken", captchaToken);
    if (evidence) body.set("photo", evidence, evidence.name);

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reports", { method: "POST", body });
      const data = await response.json().catch(() => null) as { message?: string; received?: boolean } | null;
      if (!response.ok || data?.received !== true) {
        setError(data?.message || "No pudimos enviar la información. Inténtalo de nuevo más tarde.");
        return;
      }
      router.push("/reporte/confirmacion");
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
    <label>Tipo de información
      <select name="informationKind" value={kind} onChange={(event) => setKind(event.target.value as InformationKind)}>
        {options.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}
      </select>
    </label>
    {needsPhone && <p className="urgent-note" role="status">Para este tipo de información necesitamos un número que permita al equipo contactarte.</p>}
    <label>Fecha aproximada (opcional)<input name="eventDate" type="date" /></label>
    <label>Hora aproximada (opcional)<input name="eventTime" type="time" /></label>
    <label>Lugar del posible avistamiento o información{isSighting ? "" : " (opcional)"}
      <input name="location" required={isSighting} maxLength={240} autoCapitalize="words" />
    </label>
    <label>Descripción<textarea name="description" required minLength={10} maxLength={3000} /></label>
    <label className="button secondary file-button">Adjuntar evidencia (opcional)
      <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectEvidence(event.target.files?.[0])} />
    </label>
    {evidence && <p className="file-selected">Archivo seleccionado: {evidence.name}</p>}
    <label>Tu número para contactarte{needsPhone ? "" : " (opcional)"}
      <input name="phone" required={needsPhone} type="tel" inputMode="tel" minLength={7} maxLength={40} autoComplete="tel" />
    </label>
    <p className="privacy-note">Tu información será revisada por el equipo. Si es necesario, el equipo contactará a la familia o a la persona que hizo el reporte. Tu número no será público.</p>
    <label className="check"><input name="consent" type="checkbox" required /> Confirmo que esta información es de buena fe y autorizo que sea revisada por el equipo.</label>
    {captchaEnabled && <>
      <Turnstile siteKey={captchaSiteKey} onToken={onCaptchaToken} onError={onCaptchaError} />
      {captchaPending && <p id="captcha-submit-help" className="hint" role="status">Completa la verificación de seguridad para habilitar el envío.</p>}
      {captchaError && <p className="form-error" role="alert">{captchaError}</p>}
    </>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <button className="button" type="submit" disabled={busy || captchaPending} aria-describedby={captchaPending ? "captcha-submit-help" : undefined}>
      {busy ? "Enviando…" : "Enviar información"}
    </button>
  </form>;
}
