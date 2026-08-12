import type { ConditionStatus, VerificationLevel } from "./types";
export function canSetCondition(actorRole: string, next: ConditionStatus, verification: VerificationLevel, reason?: string, authorityReference?: string) {
  if (next !== "deceased_confirmed") return actorRole === "admin" || actorRole === "moderator";
  return actorRole === "admin" && verification === "authority_confirmed" && Boolean(reason?.trim()) && Boolean(authorityReference?.trim());
}
