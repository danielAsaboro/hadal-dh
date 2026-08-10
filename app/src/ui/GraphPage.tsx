import type { AgentRunSnapshot } from "../ai/run-events";
import type { ChangeCase } from "../domain/case";
import { CaseGraphEvidence } from "./CaseSections";
import { ChangeFlow } from "./ChangeFlow";

export default function GraphPage({ value, run }: Readonly<{
  value: ChangeCase;
  run?: AgentRunSnapshot;
}>) {
  return (
    <div className="case-page case-graph-page">
      <ChangeFlow value={value} {...(run === undefined ? {} : { run })} />
      <CaseGraphEvidence value={value} />
    </div>
  );
}
