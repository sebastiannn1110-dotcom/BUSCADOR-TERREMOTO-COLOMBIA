import { conditionMeta, verificationLabels } from "@/lib/status";
import type { ConditionStatus, VerificationLevel } from "@/lib/types";

type StatusBadgeProps = {
  status: ConditionStatus;
  verificationLevel?: VerificationLevel;
  publicSourceLabel?: string | null;
};

function isMedicinaLegal(label?: string | null) {
  return label?.trim().toLocaleLowerCase("es") === "medicina legal";
}

export function publicConditionLabel({ status, verificationLevel, publicSourceLabel }: StatusBadgeProps) {
  if (status === "deceased_confirmed" && verificationLevel === "authority_confirmed") {
    return isMedicinaLegal(publicSourceLabel)
      ? "Declarado muerto por Medicina Legal"
      : "Fallecimiento confirmado por fuente oficial";
  }
  return conditionMeta[status].label;
}

export function StatusBadge(props: StatusBadgeProps) {
  const metadata = conditionMeta[props.status];
  return <span className={`badge ${metadata.tone}`}><span aria-hidden>●</span>{publicConditionLabel(props)}</span>;
}

export function VerificationBadge({ level }: { level: VerificationLevel }) {
  return <span className="verification">✓ {verificationLabels[level]}</span>;
}
