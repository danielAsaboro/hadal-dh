import type { ChangeCase } from "../domain/case";

export function CaseRail({ cases, current, disabled, onSelect }: Readonly<{
  cases: readonly ChangeCase[];
  current: ChangeCase;
  disabled: boolean;
  onSelect: (caseKey: string) => void;
}>) {
  return (
    <aside className="case-rail" aria-label="Change cases">
      <div className="brand-lockup"><span className="cut-mark">CM/</span><span>ChangeMarshal</span></div>
      <p className="rail-label">Governed changes</p>
      <nav>
        {cases.map((item) => (
          <button
            className={item.caseKey === current.caseKey ? "case-link active" : "case-link"}
            disabled={disabled}
            key={item.caseKey}
            onClick={() => onSelect(item.caseKey)}
          >
            <span>{item.change.modelName}</span>
            <small>{item.caseKey.slice(0, 8)}</small>
          </button>
        ))}
      </nav>
      <div className="rail-foot"><span className="pulse-dot" /> DataHub canonical</div>
    </aside>
  );
}
