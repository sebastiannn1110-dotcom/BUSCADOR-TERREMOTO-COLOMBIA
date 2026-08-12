import { conditionMeta, verificationLabels } from "@/lib/status";
import type { ConditionStatus, VerificationLevel } from "@/lib/types";
export function StatusBadge({ status }: { status: ConditionStatus }) { const m = conditionMeta[status]; return <span className={`badge ${m.tone}`}><span aria-hidden>●</span>{m.label}</span>; }
export function VerificationBadge({ level }: { level: VerificationLevel }) { return <span className="verification">✓ {verificationLabels[level]}</span>; }
