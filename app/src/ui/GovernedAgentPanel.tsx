import { useState } from "react";

import type { AgentRunSnapshot } from "../ai/run-events";
import type { ChangeCase } from "../domain/case";
import { BoundedAgentEvents } from "./BoundedAgentEvents";
import { StatusIndicator } from "./StatusIndicator";

export type AgentHealth = Readonly<{ available: true; provider: "qvac"; modelId: string; managed: boolean }>;
export type AgentHealthState =
  | Readonly<{ status: "checking"; previousFailure?: string }>
  | Readonly<{ status: "available"; value: AgentHealth }>
  | Readonly<{ status: "unavailable"; message: string }>;

const initialPrompt = "Call readCase for this exact governed case. Then call generateRemediation for that exact case once to create its compatibility remediation. Do not call any other mutating tool. After its verified result, summarize and stop.";

export function GovernedAgentPanel({
  value,
  health,
  run,
  busy,
  onRun,
  onResolveApproval,
  onRetryHealth,
}: Readonly<{
  value: ChangeCase;
  health: AgentHealthState;
  run?: AgentRunSnapshot;
  busy?: string;
  onRun: (prompt: string) => void;
  onResolveApproval: (approved: boolean) => void;
  onRetryHealth: () => void;
}>) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const pending = run?.pendingApproval;
  const healthAvailable = health.status === "available";

  return (
    <section className="agent-console" aria-label="QVAC coordination controls">
      <div className="agent-console-copy">
        <p className="eyebrow">Local AI · governed tools</p>
        {health.status === "available" && <div className="integration-heading"><StatusIndicator status="verified" /><h2>{health.value.modelId} coordinator</h2></div>}
        {health.status === "checking" && (
          <div role="status" aria-label="QVAC integration status">
            <StatusIndicator status="active" />
            <h2>{health.previousFailure === undefined ? "Checking QVAC runtime…" : "QVAC health retry in progress…"}</h2>
            {health.previousFailure !== undefined && <p>Unavailable. {health.previousFailure}. The known failure remains in effect until this retry succeeds.</p>}
          </div>
        )}
        {health.status === "unavailable" && (
          <div role="status" aria-label="QVAC integration status">
            <StatusIndicator status="unavailable" />
            <h2>QVAC runtime unavailable</h2>
            <p>Unavailable. {health.message}. Coordination remains disabled until a verified health check succeeds.</p>
            <button disabled={busy !== undefined} onClick={onRetryHealth}>Retry QVAC health check</button>
          </div>
        )}
        <textarea aria-label="QVAC coordination request" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} />
      </div>
      <button
        className="agent-run-button"
        disabled={busy !== undefined || !healthAvailable || prompt.trim().length === 0}
        onClick={() => onRun(prompt)}
      >
        {busy === "agent" ? "Running real model…" : "Run QVAC coordinator"}
      </button>
      {pending && run && (
        <div className="agent-approval-card" role="group" aria-label={`Approval required for ${pending.toolName}`}>
          <div>
            <p className="eyebrow">☝ Human mutation gate</p>
            <h3>{pending.toolName}</h3>
            <dl className="approval-scope">
              <div><dt>Tool</dt><dd><code>{pending.toolName}</code></dd></div>
              <div><dt>Case key</dt><dd><code>{run.caseKey}</code></dd></div>
              <div><dt>Repository</dt><dd><code>{value.repository}</code></dd></div>
              <div><dt>Immutable head SHA</dt><dd><code>{run.headSha}</code></dd></div>
              <div><dt>Arguments hash</dt><dd><code>{pending.argumentsHash}</code></dd></div>
              <div><dt>Expires</dt><dd><time dateTime={pending.expiresAt}>{pending.expiresAt}</time></dd></div>
            </dl>
            <p className="mutation-boundary">
              Approval authorizes only this exact hashed tool call for this case and immutable Git head.
              It may mutate configured systems through this tool; no outcome or artifact path is guaranteed before execution.
            </p>
          </div>
          <div className="agent-approval-buttons">
            <button disabled={busy !== undefined} onClick={() => onResolveApproval(false)}>Deny {pending.toolName}</button>
            <button className="primary-action" disabled={busy !== undefined} onClick={() => onResolveApproval(true)}>Approve {pending.toolName}</button>
          </div>
        </div>
      )}
      {run?.answer && <article className="agent-answer"><p className="eyebrow">Grounded model response</p><p>{run.answer}</p></article>}
      {run && (
        <BoundedAgentEvents
          key={run.runId}
          events={run.events}
          label="Agent audit events"
          className="agent-events"
          renderEvent={(event) => <li key={event.sequence}><span>{String(event.sequence).padStart(2, "0")}</span><strong>{event.kind.replaceAll("_", " ")}</strong><small>{event.summary}</small></li>}
        />
      )}
    </section>
  );
}
