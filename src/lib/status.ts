import type { ConditionStatus, VerificationLevel } from "./types";
export const conditionMeta: Record<ConditionStatus, { label: string; tone: string }> = {
  missing: { label: "Desaparecida", tone: "amber" },
  possibly_trapped: { label: "Posiblemente atrapada", tone: "danger" },
  located_alive: { label: "Localizada con vida", tone: "green" },
  reunited: { label: "Reunida con su familia", tone: "green" },
  deceased_confirmed: { label: "Fallecimiento confirmado", tone: "slate" },
  closed: { label: "Caso cerrado", tone: "slate" }
};
export const verificationLabels: Record<VerificationLevel, string> = { unverified: "Sin verificar", moderator_reviewed: "Revisado por moderación", authority_confirmed: "Confirmado por autoridad" };
export function formatDate(value?: string | null) { return value ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "No informado"; }
