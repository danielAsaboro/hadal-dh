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
      <span aria-hidden="true">{value.icon}</span> {value.label}
    </span>
  );
}
