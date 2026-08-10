import { useState } from "react";

import type { AgentRunSnapshot } from "../ai/run-events";
import type { DurableAgentRun } from "../domain/agent-audit";
import type { ChangeCase } from "../domain/case";
import { BoundedAgentEvents } from "./BoundedAgentEvents";
import { Button } from "./components/ui/Button";
import { Textarea } from "./components/ui/Textarea";
import { Icons } from "./icons";
import { StatusIndicator } from "./StatusIndicator";

export type AgentHealth = Readonly<{ available: true; provider: "qvac"; modelId: string; managed: boolean }>;
export type AgentHealthState =
  | Readonly<{ status: "checking"; previousFailure?: string }>
  | Readonly<{ status: "available"; value: AgentHealth }>
  | Readonly<{ status: "unavailable"; message: string }>;

export type AgentRunRehydrationState =
  | Readonly<{ status: "loading"; runId: string }>
  | Readonly<{ status: "unavailable"; run: DurableAgentRun; message: string }>;

const initialPrompt = "Call readCase for this exact governed case. Then call generateRemediation for that exact case once to create its compatibility remediation. Do not call any other mutating tool. After its verified result, summarize and stop.";

export function GovernedAgentPanel({
  value,
  health,
  run,
  rehydration,
  busy,
  onRun,
  onResolveApproval,
  onRetryHealth,
}: Readonly<{
  value: ChangeCase;
  health: AgentHealthState;
  run?: AgentRunSnapshot;
  rehydration?: AgentRunRehydrationState;
  busy?: string;
  onRun: (prompt: string) => void;
  onResolveApproval: (approved: boolean) => void;
  onRetryHealth: () => void;
}>) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const pending = run?.pendingApproval;
  const durablePending = rehydration?.status === "unavailable" ? rehydration.run.pendingApproval : undefined;
  const healthAvailable = health.status === "available";
  const resumeBlocked = rehydration !== undefined;

  return (
    <section className="agent-console" aria-label="QVAC coordination controls" aria-busy={rehydration?.status === "loading"}>
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
            <Button variant="secondary" disabled={busy !== undefined} onClick={onRetryHealth}><Icons.refresh aria-hidden="true" size={16} /> Retry QVAC health check</Button>
          </div>
        )}
        <Textarea aria-label="QVAC coordination request" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} />
      </div>
      <Button
        variant="primary"
        className="agent-run-button"
        disabled={busy !== undefined || !healthAvailable || resumeBlocked || prompt.trim().length === 0}
        onClick={() => onRun(prompt)}
      >
        <Icons.play aria-hidden="true" size={16} />
        {busy === "agent" ? "Running real model…" : "Run QVAC coordinator"}
      </Button>
      {rehydration?.status === "loading" && (
        <div className="agent-rehydration-state" role="status">
          <StatusIndicator status="active" />
          <strong>Restoring durable QVAC run {rehydration.runId}…</strong>
          <span>Mutation controls remain disabled until the exact in-memory approval token is verified.</span>
        </div>
      )}
      {rehydration?.status === "unavailable" && durablePending !== undefined && (
        <div className="agent-approval-card agent-approval-unavailable" role="group" aria-label={`Approval cannot be resumed for ${durablePending.toolName}`}>
          <div>
            <p className="eyebrow">— Durable pending mutation gate</p>
            <div className="integration-heading"><StatusIndicator status="unavailable" /><h3>{durablePending.toolName}</h3></div>
            <dl className="approval-scope">
              <div><dt>Run</dt><dd><code>{rehydration.run.runId}</code></dd></div>
              <div><dt>Tool</dt><dd><code>{durablePending.toolName}</code></dd></div>
              <div><dt>Case key</dt><dd><code>{rehydration.run.caseKey}</code></dd></div>
              <div><dt>Repository</dt><dd><code>{value.repository}</code></dd></div>
              <div><dt>Immutable head SHA</dt><dd><code>{rehydration.run.headSha}</code></dd></div>
              <div><dt>Arguments hash</dt><dd><code>{durablePending.argumentsHash}</code></dd></div>
              <div><dt>Expires</dt><dd><time dateTime={durablePending.expiresAt}>{durablePending.expiresAt}</time></dd></div>
            </dl>
            <p className="mutation-boundary">
              Approval cannot be resumed because the coordinator state or exact token is unavailable. {rehydration.message}
              The durable scope remains visible for audit, but no mutation control is enabled.
            </p>
          </div>
        </div>
      )}
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
            <Button variant="destructive" disabled={busy !== undefined} onClick={() => onResolveApproval(false)}><Icons.close aria-hidden="true" size={16} /> Deny {pending.toolName}</Button>
            <Button variant="primary" className="primary-action" disabled={busy !== undefined} onClick={() => onResolveApproval(true)}><Icons.check aria-hidden="true" size={16} /> Approve {pending.toolName}</Button>
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
      {run === undefined && rehydration === undefined && (
        <p className="agent-empty-state" role="status">No active QVAC run is available for this governed case.</p>
      )}
    </section>
  );
}
