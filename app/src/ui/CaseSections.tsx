import { useState, type ReactNode } from "react";

import type { ChangeCase } from "../domain/case";
import {
  indexOwnerMappings,
  inspectApprovalRequirement,
  inspectWorkProjection,
  type ApprovalDecisionDefect,
  type ProjectionDefect,
} from "../domain/policy-evidence";
import { BoundedAgentEvents } from "./BoundedAgentEvents";
import { Badge } from "./components/ui/Badge";
import { Button } from "./components/ui/Button";
import { Icons } from "./icons";
import { OperationalStatusIcon, statusPresentation, type OperationalStatus } from "./StatusIndicator";

const pageSize = 25;

export function shortUrn(urn: string): string {
  if (urn.includes(",")) return urn.split(",").at(-2)?.split(".").at(-1) ?? urn;
  return urn.split(":").at(-1) ?? urn;
}

const operationalState: Readonly<Record<string, OperationalStatus>> = {
  ready: "verified",
  allowed: "verified",
  approve: "verified",
  approved: "verified",
  completed: "verified",
  resolved: "verified",
  verified: "verified",
  unverified: "blocked",
  blocked: "blocked",
  blocked_context: "blocked",
  blocked_ownership: "blocked",
  blocked_approval: "blocked",
  blocked_validation: "blocked",
  in_progress: "active",
  running: "active",
  waiting: "waiting",
  waiting_for_approval: "waiting",
  pending: "waiting",
  planned: "waiting",
  draft: "waiting",
  stale: "failed",
  reject: "failed",
  error: "failed",
  failed: "failed",
};

export function StatePill({ value }: { readonly value: string }) {
  const text = value.replaceAll("_", " ");
  const state = operationalState[value];
  const className = `state-pill state-${value.replaceAll("_", "-")}`;
  if (state === undefined) return <Badge className={className}>{text}</Badge>;
  const { statusLabel } = statusPresentation(state);
  const label = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return (
    <Badge variant={state} className={`${className} state-family-${state}`} role="img" aria-label={`${label}: ${statusLabel} status`}>
      <OperationalStatusIcon status={state} size={13} />
      <span>{text}</span>
    </Badge>
  );
}

function Empty({ children }: { readonly children: string }) {
  return <p className="empty-state">{children}</p>;
}

function usePagination<T>(values: readonly T[]) {
  const [requestedPage, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(values.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const start = (page - 1) * pageSize;
  return {
    rows: values.slice(start, start + pageSize),
    page,
    pageCount,
    total: values.length,
    start,
    setPage,
  };
}

function PagePagination({ page, pageCount, total, label, onPage }: Readonly<{
  page: number;
  pageCount: number;
  total: number;
  label: string;
  onPage: (page: number) => void;
}>) {
  return (
    <div className="pagination-bar case-pagination">
      <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => onPage(page - 1)}><Icons.arrowLeft aria-hidden="true" size={15} /> Previous</Button>
      <span role="status" aria-label={`${label} pagination`}>Page {page} of {pageCount} · {total} rows</span>
      <Button variant="secondary" size="sm" disabled={page === pageCount} onClick={() => onPage(page + 1)}>Next <Icons.arrowRight aria-hidden="true" size={15} /></Button>
    </div>
  );
}

function BoundedEvidence({ values, render, label }: Readonly<{
  values: readonly ReactNode[];
  render: (value: ReactNode, index: number) => ReactNode;
  label: string;
}>) {
  const leading = values.slice(0, pageSize);
  const remaining = values.slice(pageSize);
  return (
    <>
      {leading.map(render)}
      {remaining.length > 0 && (
        <details className="nested-evidence-disclosure">
          <summary>Show {remaining.length} more {label}</summary>
          {remaining.map((value, index) => render(value, pageSize + index))}
        </details>
      )}
    </>
  );
}

function projectionDefectText(
  defect: ProjectionDefect,
  state: ChangeCase["externalProjections"][number]["state"],
  expectedAssignee: string | undefined,
): string {
  if (defect === "state") return `Projection state is ${state}; verified evidence is required.`;
  if (defect === "revision") return "Projection revision does not match the current governed revision.";
  if (defect === "head") return "Projection Git head does not match the current immutable Git head.";
  if (defect === "verification_time") return "Projection has not been verified.";
  return expectedAssignee === undefined
    ? "Projection assignee cannot be verified because the expected GitHub actor is not mapped."
    : `Projection assignee does not match expected GitHub actor ${expectedAssignee}.`;
}

function approvalDefectText(defect: ApprovalDecisionDefect, expectedActor: string | undefined): string {
  if (defect === "revision") return "Decision revision does not match the current governed revision.";
  if (defect === "head") return "Decision Git head does not match the current immutable Git head.";
  if (defect === "role") return "Decision role does not match the required role.";
  if (defect === "owner") return "Decision owner does not match the required owner URN.";
  if (defect === "provenance") return "GitHub provenance is incomplete; both external ID and review URL are required.";
  return expectedActor === undefined
    ? "Decision actor cannot be verified because the expected GitHub actor is not mapped."
    : `Decision actor does not match expected GitHub actor ${expectedActor}.`;
}

export function CaseOverview({ value, busy, actionStatus, onSync, onReconcile, onEvaluate }: Readonly<{
  value: ChangeCase;
  busy?: string;
  actionStatus: string;
  onSync: () => void;
  onReconcile: () => void;
  onEvaluate: () => void;
}>) {
  const blockers = value.admission?.blockers ?? ["ADMISSION_NOT_EVALUATED"];
  const ownerMappings = indexOwnerMappings(value);
  const verifiedWork = value.workItems.filter((work) => inspectWorkProjection(value, work, ownerMappings).verified).length;
  return (
    <div className="case-page case-overview-page">
      <span className="sr-only" role="status" aria-label="Case action status" aria-live="polite">{actionStatus}</span>
      <section className="command-bar" aria-label="Case actions" aria-busy={busy !== undefined}>
        <Button variant="secondary" disabled={busy !== undefined} onClick={onSync}><Icons.refresh aria-hidden="true" size={16} />{busy === "sync" ? "Syncing owner work…" : "Sync owner work"}</Button>
        <Button variant="secondary" disabled={busy !== undefined} onClick={onReconcile}><Icons.repository aria-hidden="true" size={16} />{busy === "reconcile" ? "Reconciling GitHub…" : "Reconcile GitHub"}</Button>
        <Button variant="primary" className="primary-action" disabled={busy !== undefined} onClick={onEvaluate}><Icons.shield aria-hidden="true" size={16} />
          {busy === "decide" ? "Verifying…" : "Evaluate merge"}
        </Button>
      </section>

      <section className="stage-summary" aria-labelledby="case-stage-summary-title">
        <div className="section-heading"><div><p className="eyebrow">Current governed facts</p><h2 id="case-stage-summary-title">Case stage summary</h2></div></div>
        <div className="metric-grid" aria-label="Case summary">
          <article><span>Graph paths</span><strong>{value.evidence.paths.length}</strong></article>
          <article><span>Owners engaged</span><strong>{new Set(value.workItems.map((item) => item.ownerUrn)).size}</strong></article>
          <article><span>Verified work</span><strong>{verifiedWork}/{value.workItems.length}</strong></article>
          <article className={blockers.length ? "metric-alert" : "metric-clear"}><span>Merge blockers</span><strong>{blockers.length}</strong></article>
        </div>
      </section>

      <section className="panel blockers-panel" aria-labelledby="merge-authority-title">
        <div className="section-heading"><div><p className="eyebrow">Deterministic policy</p><h2 id="merge-authority-title">Merge authority</h2></div><StatePill value={value.admission?.allowed ? "allowed" : "blocked"} /></div>
        {blockers.length === 0 ? <Empty>Every governed requirement is verified for this Git head.</Empty> : (
          <>
            <ul className="blocker-list">{blockers.slice(0, pageSize).map((blocker) => <li key={blocker}><span>!</span><code>{blocker}</code></li>)}</ul>
            {blockers.length > pageSize && (
              <details className="nested-evidence-disclosure">
                <summary>Show {blockers.length - pageSize} more blocker{blockers.length - pageSize === 1 ? "" : "s"}</summary>
                <ul className="blocker-list">{blockers.slice(pageSize).map((blocker) => <li key={blocker}><span>!</span><code>{blocker}</code></li>)}</ul>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export function CaseWork({ value }: Readonly<{ value: ChangeCase }>) {
  const pagination = usePagination(value.workItems);
  const ownerMappings = indexOwnerMappings(value);
  return (
    <section className="case-page panel case-work-page" aria-labelledby="case-work-title" aria-label="Owner work">
      <div className="section-heading"><div><p className="eyebrow">Accountable execution</p><h2 id="case-work-title">Owner work</h2></div><span className="count">{value.workItems.length}</span></div>
      {value.workItems.length === 0 ? <Empty>No work can be derived until graph evidence and ownership are complete.</Empty> : (
        <div className="work-stack">{pagination.rows.map((work) => {
          const projectionInspection = inspectWorkProjection(value, work, ownerMappings);
          const receipts = value.validationReceipts.filter((item) => item.workKey === work.workKey);
          return (
            <article className="work-card" key={work.workKey}>
              <div className="work-top"><StatePill value={work.kind} /><span>{shortUrn(work.ownerUrn)}</span></div>
              <h3>{work.title}</h3>
              <p>{work.affectedUrns.map(shortUrn).join(", ")}</p>
              <div className="work-evidence-grid">
                <section aria-label={`Completion criteria for ${work.title}`}>
                  <h4>Completion criteria</h4>
                  <ul>{work.completionCriteria.slice(0, pageSize).map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>
                  {work.completionCriteria.length > pageSize && (
                    <details className="nested-evidence-disclosure">
                      <summary>Show {work.completionCriteria.length - pageSize} more completion criterion{work.completionCriteria.length - pageSize === 1 ? "" : "s"}</summary>
                      <ul>{work.completionCriteria.slice(pageSize).map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>
                    </details>
                  )}
                </section>
                <section aria-label={`GitHub projections for ${work.title}`}>
                  <h4>GitHub projection</h4>
                  {projectionInspection.collection === "missing" ? <strong className="evidence-missing">GitHub projection missing</strong> : (
                    <>
                      {projectionInspection.collection === "conflict" && (
                        <strong className="evidence-defect">Projection set is unverified: expected exactly one projection; found {projectionInspection.records.length}.</strong>
                      )}
                      <BoundedEvidence
                        label="GitHub projections"
                        values={projectionInspection.records.map((record) => {
                          const projection = record.value;
                          return (
                            <div className="evidence-record" key={`${projection.externalId}-${projection.url}`}>
                              <StatePill value={record.verified ? "verified" : "unverified"} />
                              <a href={projection.url} target="_blank" rel="noreferrer">Open GitHub issue ↗</a>
                              <span>Assignee <code>{projection.assignee}</code></span>
                              <span>Git head <code>{projection.headSha}</code></span>
                              {projection.verifiedAt !== null && <time dateTime={projection.verifiedAt}>{projection.verifiedAt}</time>}
                              {record.defects.map((defect) => <strong className="evidence-defect" key={defect}>{projectionDefectText(defect, projection.state, projectionInspection.expectedAssignee)}</strong>)}
                            </div>
                          );
                        })}
                        render={(projection) => projection}
                      />
                    </>
                  )}
                </section>
                <section aria-label={`Validation receipts for ${work.title}`}>
                  <h4>Validation receipt</h4>
                  {receipts.length === 0 ? <strong className="evidence-missing">Validation receipt missing</strong> : (
                    <BoundedEvidence
                      label="validation receipts"
                      values={receipts.map((receipt) => (
                        <div className="evidence-record" key={receipt.receiptKey}>
                          <StatePill value={receipt.valid && receipt.headSha === value.revision.headSha ? "verified" : "failed"} />
                          <code>{receipt.command.join(" ")}</code>
                          <span>Exit {receipt.exitCode} · Git head <code>{receipt.headSha}</code></span>
                          <time dateTime={receipt.finishedAt}>{receipt.finishedAt}</time>
                          {!receipt.valid && <strong>Validation failed; this receipt does not satisfy the work.</strong>}
                          {receipt.headSha !== value.revision.headSha && <strong>Receipt does not match the current immutable Git head.</strong>}
                        </div>
                      ))}
                      render={(receipt) => receipt}
                    />
                  )}
                </section>
              </div>
            </article>
          );
        })}</div>
      )}
      <PagePagination {...pagination} label="Work" onPage={pagination.setPage} />
    </section>
  );
}

export function CaseApprovals({ value }: Readonly<{ value: ChangeCase }>) {
  const pagination = usePagination(value.approvalRequirements);
  const ownerMappings = indexOwnerMappings(value);
  return (
    <section className="case-page panel case-approvals-page" aria-labelledby="case-approvals-title">
      <div className="section-heading"><div><p className="eyebrow">Human authority · immutable scope</p><h2 id="case-approvals-title">SHA-bound human approvals</h2></div><span className="count">{value.approvalRequirements.length}</span></div>
      {value.approvalRequirements.length === 0 ? <Empty>No human approval requirements exist for the current governed revision.</Empty> : (
        <div className="approval-stack">{pagination.rows.map((requirement) => {
          const inspection = inspectApprovalRequirement(value, requirement, ownerMappings);
          const decisionRecords: ReactNode[] = inspection.records.map((record) => {
            const decision = record.value;
            const stale = record.defects.includes("head");
            return (
              <div className={`recorded-decision${stale ? " stale-decision" : record.verified ? "" : " unverified-decision"}`} key={`${decision.actorLogin}-${decision.decidedAt}-${decision.externalId ?? "decision"}`}>
                <StatePill value={record.verified ? decision.verdict : stale ? "stale" : "unverified"} />
                <strong>{decision.actorLogin}</strong>
                <span>Verdict {decision.verdict}</span>
                {record.verified
                  ? <span>Verified from GitHub for <code>{decision.headSha}</code></span>
                  : stale
                    ? <span>Stored GitHub decision for <code>{decision.headSha}</code>; not valid for the current head.</span>
                    : <span>Decision is not verified for the current governed requirement.</span>}
                <time dateTime={decision.decidedAt}>{decision.decidedAt}</time>
                {decision.url !== undefined && <a href={decision.url} target="_blank" rel="noreferrer">Open GitHub review ↗</a>}
                {record.defects.map((defect) => <strong className="evidence-defect" key={defect}>{approvalDefectText(defect, inspection.expectedActor)}</strong>)}
              </div>
            );
          });
          return (
            <article className="approval-row" key={requirement.requirementKey}>
              <div>
                <StatePill value={requirement.role} />
                <h3>{shortUrn(requirement.ownerUrn)}</h3>
                <p>{requirement.affectedUrns.length} governed asset{requirement.affectedUrns.length === 1 ? "" : "s"}</p>
                <ul className="approval-affected-urns">
                  {requirement.affectedUrns.slice(0, pageSize).map((urn) => <li key={urn}><code>{urn}</code></li>)}
                </ul>
                {requirement.affectedUrns.length > pageSize && (
                  <details className="nested-evidence-disclosure">
                    <summary>Show {requirement.affectedUrns.length - pageSize} more affected URN{requirement.affectedUrns.length - pageSize === 1 ? "" : "s"}</summary>
                    <ul className="approval-affected-urns">
                      {requirement.affectedUrns.slice(pageSize).map((urn) => <li key={urn}><code>{urn}</code></li>)}
                    </ul>
                  </details>
                )}
                <dl className="approval-requirement-facts">
                  <div><dt>Requirement</dt><dd>{requirement.requirementKey}</dd></div>
                  <div><dt>Required Git head</dt><dd>{value.revision.headSha}</dd></div>
                </dl>
              </div>
              <div className="approval-actions">
                {inspection.verifiedDecision === undefined && (
                  <div className="awaiting-decision"><strong>Awaiting verified GitHub decision</strong><small>Submit the requested review in GitHub, then reconcile.</small></div>
                )}
                {inspection.collection === "conflict" && (
                  <strong className="evidence-defect">Approval decision set is conflicted: expected exactly one decision; found {inspection.records.length}.</strong>
                )}
                {decisionRecords.length > 0 && <BoundedEvidence values={decisionRecords} label="GitHub decision" render={(decision) => decision} />}
              </div>
            </article>
          );
        })}</div>
      )}
      <PagePagination {...pagination} label="Approval" onPage={pagination.setPage} />
    </section>
  );
}

export function CaseGraphEvidence({ value }: Readonly<{ value: ChangeCase }>) {
  const pagination = usePagination(value.evidence.paths);
  return (
    <section className="case-page panel case-graph-evidence" aria-labelledby="case-paths-title">
      <div className="section-heading"><div><p className="eyebrow">DataHub graph proof</p><h2 id="case-paths-title">Exact impact paths</h2></div><span className="count">{value.evidence.paths.length}</span></div>
      {value.evidence.paths.length === 0 ? <Empty>No downstream paths were returned in the complete evidence set.</Empty> : (
        <div className="path-stack">{pagination.rows.map((path, pageIndex) => {
          const index = pagination.start + pageIndex;
          return (
            <article className="path-row" key={`${path.downstreamUrn}-${index}`}>
              <span className="path-index">{String(index + 1).padStart(2, "0")}</span>
              <div className="node-chain">{path.nodes.map((node, nodeIndex) => <span key={`${node}-${nodeIndex}`}><b>{shortUrn(node)}</b>{nodeIndex < path.nodes.length - 1 && <i>→</i>}</span>)}</div>
              <code>{path.column}{path.downstreamColumns.length ? ` → ${path.downstreamColumns.join(", ")}` : ""}</code>
            </article>
          );
        })}</div>
      )}
      <PagePagination {...pagination} label="Graph path" onPage={pagination.setPage} />
    </section>
  );
}

type TimelineEntry = Readonly<{ key: string; at: string; title: string; summary: string; failed?: boolean }>;

function timelineEntries(value: ChangeCase): readonly TimelineEntry[] {
  const entries: TimelineEntry[] = [{
    key: "case-created",
    at: value.createdAt,
    title: "Case created",
    summary: `Git evidence bound to ${value.revision.headSha.slice(0, 10)}`,
  }];
  const ownerMappings = indexOwnerMappings(value);
  const verifiedDecisions = new Set(value.approvalRequirements.flatMap((requirement) =>
    inspectApprovalRequirement(value, requirement, ownerMappings).records
      .filter((record) => record.verified)
      .map((record) => record.value)));
  for (const decision of value.approvalDecisions) entries.push({
    key: `decision-${decision.requirementKey}-${decision.decidedAt}`,
    at: decision.decidedAt,
    title: `${decision.role} ${decision.verdict}`,
    summary: verifiedDecisions.has(decision)
      ? `Verified GitHub actor ${decision.actorLogin}`
      : `Unverified GitHub decision actor ${decision.actorLogin}`,
    failed: decision.verdict === "reject" || !verifiedDecisions.has(decision),
  });
  for (const receipt of value.validationReceipts) entries.push({
    key: `receipt-${receipt.receiptKey}`,
    at: receipt.finishedAt,
    title: `Validation ${receipt.valid ? "passed" : "failed"}`,
    summary: `Receipt ${receipt.receiptKey.slice(0, 8)}`,
    failed: !receipt.valid,
  });
  if (value.dataHub.verified && value.dataHub.verifiedAt !== undefined && value.dataHub.documentUrn !== undefined) entries.push({
    key: "datahub-verified",
    at: value.dataHub.verifiedAt,
    title: "DataHub reread verified",
    summary: shortUrn(value.dataHub.documentUrn),
  });
  return entries.sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.key.localeCompare(right.key));
}

export function CaseHistory({ value }: Readonly<{ value: ChangeCase }>) {
  const timeline = usePagination(timelineEntries(value));
  const runs = usePagination([...value.agentRuns].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.runId.localeCompare(right.runId)));
  return (
    <div className="case-page case-history-page">
      <section className="panel" aria-labelledby="case-timeline-title">
        <div className="section-heading"><div><p className="eyebrow">Durable resolution history</p><h2 id="case-timeline-title">Verified timeline</h2></div></div>
        <ol className="timeline">
          {timeline.rows.map((entry) => <li className={entry.failed ? "timeline-failed" : undefined} key={entry.key}><time dateTime={entry.at}>{entry.at}</time><strong>{entry.title}</strong><span>{entry.summary}</span></li>)}
        </ol>
        <PagePagination {...timeline} label="Timeline" onPage={timeline.setPage} />
      </section>

      <section className="panel agent-run-history" aria-labelledby="agent-run-history-title">
        <div className="section-heading"><div><p className="eyebrow">Durable QVAC audit</p><h2 id="agent-run-history-title">Agent run history</h2></div><span className="count">{value.agentRuns.length}</span></div>
        {value.agentRuns.length === 0 ? <Empty>No durable agent runs are recorded for this case.</Empty> : (
          <div className="agent-run-groups">{runs.rows.map((run) => {
            const failure = run.events.findLast((event) => event.kind === "run_failed")?.summary
              ?? run.events.findLast((event) => event.kind === "tool_failed")?.summary
              ?? (run.status === "failed" ? "Run failed without verified completion" : undefined);
            return (
              <details className={`agent-run-group agent-run-${run.status.replaceAll("_", "-")}`} open={run.status === "failed"} key={run.runId}>
                <summary>
                  <span><strong>{run.runId}</strong><small>{run.modelId} · <time dateTime={run.updatedAt}>{run.updatedAt}</time></small></span>
                  <StatePill value={run.status} />
                  {failure !== undefined && <b>{failure}</b>}
                </summary>
                {run.answer !== undefined && <p className="agent-run-answer">{run.answer}</p>}
                <dl className="agent-run-facts">
                  <div><dt>Immutable head</dt><dd>{run.headSha}</dd></div>
                  <div><dt>Revision</dt><dd>{run.revisionKey}</dd></div>
                </dl>
                <BoundedAgentEvents
                  events={run.events}
                  label={`Durable agent audit for ${run.runId}`}
                  className="timeline agent-audit-timeline"
                  renderEvent={(event) => <li className={event.kind === "run_failed" || event.kind === "tool_failed" ? "timeline-failed" : undefined} key={event.sequence}>
                    <time dateTime={event.at}>{event.at}</time>
                    <strong>{event.kind.replaceAll("_", " ")}</strong>
                    <span>{event.summary}</span>
                  </li>}
                />
              </details>
            );
          })}</div>
        )}
        <PagePagination {...runs} label="Agent run" onPage={runs.setPage} />
      </section>
    </div>
  );
}
