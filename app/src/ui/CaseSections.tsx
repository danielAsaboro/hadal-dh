import { useMemo } from "react";

import type { ChangeCase } from "../domain/case";
import { statusPresentation, type OperationalStatus } from "./StatusIndicator";

function shortUrn(urn: string): string {
  if (urn.includes(",")) return urn.split(",").at(-2)?.split(".").at(-1) ?? urn;
  return urn.split(":").at(-1) ?? urn;
}

const operationalState: Readonly<Record<string, OperationalStatus>> = {
  ready: "verified",
  allowed: "verified",
  approve: "verified",
  approved: "verified",
  resolved: "verified",
  verified: "verified",
  blocked: "blocked",
  blocked_context: "blocked",
  blocked_ownership: "blocked",
  blocked_approval: "blocked",
  blocked_validation: "blocked",
  in_progress: "active",
  waiting: "waiting",
  pending: "waiting",
  planned: "waiting",
  draft: "waiting",
  stale: "failed",
  reject: "failed",
  error: "failed",
};

export function StatePill({ value }: { readonly value: string }) {
  const text = value.replaceAll("_", " ");
  const state = operationalState[value];
  const className = `state-pill state-${value.replaceAll("_", "-")}`;
  if (state === undefined) return <span className={className}>{text}</span>;
  const { statusLabel, statusIcon } = statusPresentation(state);
  const label = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return (
    <span className={`${className} state-family-${state}`} role="img" aria-label={`${label}: ${statusLabel} status`}>
      <span aria-hidden="true">{statusIcon}</span>
      <span>{text}</span>
    </span>
  );
}

function Empty({ children }: { readonly children: string }) {
  return <p className="empty-state">{children}</p>;
}

export function CaseSections({ value }: Readonly<{ value: ChangeCase }>) {
  const decisions = useMemo(() => new Map(value.approvalDecisions.map((item) => [item.requirementKey, item])), [value]);
  const projections = useMemo(() => new Map(value.externalProjections.map((item) => [item.workKey, item])), [value]);
  const receipts = useMemo(() => new Map(value.validationReceipts.map((item) => [item.workKey, item])), [value]);
  const blockers = value.admission?.blockers ?? ["ADMISSION_NOT_EVALUATED"];

  return (
    <>
      <section className="metric-grid" aria-label="Case summary">
        <article><span>Graph paths</span><strong>{value.evidence.paths.length}</strong></article>
        <article><span>Owners engaged</span><strong>{new Set(value.workItems.map((item) => item.ownerUrn)).size}</strong></article>
        <article><span>Verified work</span><strong>{value.externalProjections.filter((item) => item.state === "verified").length}/{value.workItems.length}</strong></article>
        <article className={blockers.length ? "metric-alert" : "metric-clear"}><span>Merge blockers</span><strong>{blockers.length}</strong></article>
      </section>

      <section className="panel blockers-panel">
        <div className="section-heading"><div><p className="eyebrow">Deterministic policy</p><h2>Merge authority</h2></div><StatePill value={value.admission?.allowed ? "allowed" : "blocked"} /></div>
        {blockers.length === 0 ? <Empty>Every governed requirement is verified for this Git head.</Empty> : (
          <ul className="blocker-list">{blockers.map((blocker) => <li key={blocker}><span>!</span><code>{blocker}</code></li>)}</ul>
        )}
      </section>

      <div className="two-column">
        <section className="panel" id="work">
          <div className="section-heading"><div><p className="eyebrow">Accountable execution</p><h2>Owner work</h2></div><span className="count">{value.workItems.length}</span></div>
          {value.workItems.length === 0 ? <Empty>No work can be derived until graph evidence and ownership are complete.</Empty> : (
            <div className="work-stack">{value.workItems.map((work) => {
              const projection = projections.get(work.workKey);
              const receipt = receipts.get(work.workKey);
              return <article className="work-card" key={work.workKey}>
                <div className="work-top"><StatePill value={work.kind} /><span>{shortUrn(work.ownerUrn)}</span></div>
                <h3>{work.title}</h3>
                <p>{work.affectedUrns.map(shortUrn).join(", ")}</p>
                <div className="work-facts"><span>{projection?.state === "verified" ? "Issue verified" : "Issue pending"}</span><span>{receipt?.valid ? "Receipt valid" : "Receipt missing"}</span></div>
                {projection && <a href={projection.url} target="_blank" rel="noreferrer">Open GitHub issue ↗</a>}
              </article>;
            })}</div>
          )}
        </section>

        <section className="panel" id="approvals">
          <div className="section-heading"><div><p className="eyebrow">SHA-bound decisions</p><h2>Approvals</h2></div><span className="count">{value.approvalRequirements.length}</span></div>
          <div className="approval-stack">{value.approvalRequirements.map((requirement) => {
            const decision = decisions.get(requirement.requirementKey);
            return <article className="approval-row" key={requirement.requirementKey}>
              <div><StatePill value={requirement.role} /><h3>{shortUrn(requirement.ownerUrn)}</h3><p>{requirement.affectedUrns.length} governed asset{requirement.affectedUrns.length === 1 ? "" : "s"}</p></div>
              {decision
                ? <div className="approval-actions"><StatePill value={decision.verdict} />{decision.url && <a href={decision.url} target="_blank" rel="noreferrer">Open review ↗</a>}</div>
                : <div className="approval-actions"><span>Awaiting</span><small>Submit the requested review in GitHub, then reconcile.</small></div>}
            </article>;
          })}</div>
        </section>
      </div>

      <section className="panel" id="evidence">
        <div className="section-heading"><div><p className="eyebrow">DataHub graph proof</p><h2>Exact impact paths</h2></div><span className="count">{value.evidence.paths.length}</span></div>
        {value.evidence.paths.length === 0 ? <Empty>No downstream paths were returned in the complete evidence set.</Empty> : (
          <div className="path-stack">{value.evidence.paths.map((path, index) => <article className="path-row" key={`${path.downstreamUrn}-${index}`}>
            <span className="path-index">{String(index + 1).padStart(2, "0")}</span>
            <div className="node-chain">{path.nodes.map((node, nodeIndex) => <span key={`${node}-${nodeIndex}`}><b>{shortUrn(node)}</b>{nodeIndex < path.nodes.length - 1 && <i>→</i>}</span>)}</div>
            <code>{path.column}{path.downstreamColumns.length ? ` → ${path.downstreamColumns.join(", ")}` : ""}</code>
          </article>)}</div>
        )}
      </section>

      <section className="panel" id="history">
        <div className="section-heading"><div><p className="eyebrow">Durable resolution history</p><h2>Verified timeline</h2></div></div>
        <ol className="timeline">
          <li><time>{value.createdAt}</time><strong>Case created</strong><span>Git evidence bound to {value.revision.headSha.slice(0, 10)}</span></li>
          {value.approvalDecisions.map((decision) => <li key={decision.requirementKey}><time>{decision.decidedAt}</time><strong>{decision.role} {decision.verdict}</strong><span>Verified GitHub actor {decision.actorLogin}</span></li>)}
          {value.validationReceipts.map((receipt) => <li key={receipt.receiptKey}><time>{receipt.finishedAt}</time><strong>Validation {receipt.valid ? "passed" : "failed"}</strong><span>Receipt {receipt.receiptKey.slice(0, 8)}</span></li>)}
          {value.dataHub.verified && value.dataHub.verifiedAt && value.dataHub.documentUrn && <li><time>{value.dataHub.verifiedAt}</time><strong>DataHub reread verified</strong><span>{shortUrn(value.dataHub.documentUrn)}</span></li>}
        </ol>
        {value.agentRuns.length > 0 && <>
          <h3 className="history-subheading">Agent execution audit</h3>
          <ol className="timeline agent-audit-timeline" aria-label="Durable agent audit">
            {value.agentRuns.flatMap((run) => run.events.map((event) => <li key={`${run.runId}-${event.sequence}`}>
              <time>{event.at}</time>
              <strong>{event.kind.replaceAll("_", " ")}</strong>
              <span>{run.modelId} · {event.summary}</span>
            </li>))}
          </ol>
        </>}
      </section>
    </>
  );
}
