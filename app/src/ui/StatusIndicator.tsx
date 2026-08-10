import { Icons } from "./icons";

export type OperationalStatus = "verified" | "active" | "waiting" | "blocked" | "failed" | "unavailable";

const presentation: Record<OperationalStatus, Readonly<{ label: string; icon: string }>> = {
  verified: { label: "Verified", icon: "✓" },
  active: { label: "Active", icon: "◆" },
  waiting: { label: "Waiting", icon: "◷" },
  blocked: { label: "Blocked", icon: "■" },
  failed: { label: "Failed", icon: "×" },
  unavailable: { label: "Unavailable", icon: "—" },
};

export function statusPresentation(status: OperationalStatus): Readonly<{ statusLabel: string; statusIcon: string }> {
  const value = presentation[status];
  return { statusLabel: value.label, statusIcon: value.icon };
}

export function OperationalStatusIcon({ status, size = 14 }: Readonly<{ status: OperationalStatus; size?: number }>) {
  const Icon = status === "verified"
    ? Icons.verified
    : status === "active"
      ? Icons.activity
      : status === "waiting"
        ? Icons.waiting
        : status === "failed"
          ? Icons.failed
          : Icons.warning;
  return <Icon aria-hidden="true" size={size} strokeWidth={2} />;
}

export function StatusIndicator({ status, className = "" }: Readonly<{
  status: OperationalStatus;
  className?: string;
}>) {
  const value = presentation[status];
  return (
    <span
      className={`flow-state flow-state-${status}${className.length === 0 ? "" : ` ${className}`}`}
      role="img"
      aria-label={`${value.label} status`}
    >
      <OperationalStatusIcon status={status} /> {value.label}
    </span>
  );
}
