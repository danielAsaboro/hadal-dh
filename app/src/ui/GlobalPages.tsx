import { useState } from "react";

import type { ChangeCase } from "../domain/case";
import { StatePill } from "./CaseSections";
import { WorkspaceLink } from "./AppRail";
import { Button } from "./components/ui/Button";
import { Icons } from "./icons";
import type { WorkspacePage } from "./routes";
import {
  paginateRows,
  selectActiveCases,
  selectApprovalRows,
  selectAttentionCases,
  selectRecentlyResolvedCases,
  selectWorkRows,
} from "./workspace-selectors";

function CaseIdentity({ value, onNavigate }: Readonly<{ value: ChangeCase; onNavigate: (destination: string) => void }>) {
  const destination = `/workspace/cases/${value.caseKey}/overview`;
  return (
    <WorkspaceLink destination={destination} onNavigate={onNavigate} className="table-case-link">
      <strong>{value.change.modelName}</strong>
      <span>{value.repository}</span>
      <code>{value.caseKey}</code>
    </WorkspaceLink>
  );
}

function EmptyCases() {
  return (
    <div role="status" aria-label="Governed case empty state" className="global-empty">
      <p>No governed Hadal cases exist in DataHub.</p>
      <p>A canonical DataHub change case is required before work can begin.</p>
    </div>
  );
}

function Pagination({ page, pageCount, total, label, onPage }: Readonly<{
  page: number;
  pageCount: number;
  total: number;
  label: string;
  onPage: (page: number) => void;
}>) {
  return (
    <div className="pagination-bar">
      <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => onPage(page - 1)}><Icons.arrowLeft aria-hidden="true" size={15} /> Previous</Button>
      <span role="status" aria-label={`${label} pagination`}>Page {page} of {pageCount} · {total} rows</span>
      <Button variant="secondary" size="sm" disabled={page === pageCount} onClick={() => onPage(page + 1)}>Next <Icons.arrowRight aria-hidden="true" size={15} /></Button>
    </div>
  );
}

function HomePage({ cases, onNavigate }: Readonly<{ cases: readonly ChangeCase[]; onNavigate: (destination: string) => void }>) {
  const attention = selectAttentionCases(cases);
  const active = selectActiveCases(cases);
  const resolved = selectRecentlyResolvedCases(cases);
  return (
    <main className="global-main" aria-labelledby="home-page-title">
      <header className="global-heading">
        <p className="eyebrow">Governed operations</p>
        <h1 id="home-page-title" data-page-heading tabIndex={-1}>Operational overview</h1>
        <p>Prioritized from canonical case facts, durable approvals, GitHub projections, and validation receipts.</p>
      </header>
      {cases.length === 0 ? <EmptyCases /> : (
        <>
          <section className="global-panel" aria-labelledby="attention-title">
            <div className="section-heading"><div><p className="eyebrow">Priority queue</p><h2 id="attention-title">Needs attention</h2></div><span className="count">{attention.length}</span></div>
            <ol className="attention-list">
              {attention.map((row) => (
                <li key={row.case.caseKey}>
                  <span className={`attention-category attention-${row.category}`}>{row.category === "approval" ? "approval required" : row.category}</span>
                  <CaseIdentity value={row.case} onNavigate={onNavigate} />
                  <time dateTime={row.latestAt}>{row.latestAt}</time>
                </li>
              ))}
            </ol>
          </section>
          <div className="home-summary-grid">
            <section className="global-panel" aria-labelledby="active-cases-title">
              <div className="section-heading"><div><p className="eyebrow">In motion</p><h2 id="active-cases-title">Active cases</h2></div><span className="count">{active.length}</span></div>
              {active.length === 0 ? <p className="global-empty-copy">No active cases in the canonical collection.</p> : (
                <ul className="compact-case-list">{active.map((value) => <li key={value.caseKey}><CaseIdentity value={value} onNavigate={onNavigate} /></li>)}</ul>
              )}
            </section>
            <section className="global-panel" aria-labelledby="resolved-cases-title">
              <div className="section-heading"><div><p className="eyebrow">Durable outcomes</p><h2 id="resolved-cases-title">Recently resolved</h2></div><span className="count">{resolved.length}</span></div>
              {resolved.length === 0 ? <p className="global-empty-copy">No resolved cases in the canonical collection.</p> : (
                <ul className="compact-case-list">{resolved.map((value) => <li key={value.caseKey}><CaseIdentity value={value} onNavigate={onNavigate} /></li>)}</ul>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}

function CasesPage({ cases, onNavigate }: Readonly<{ cases: readonly ChangeCase[]; onNavigate: (destination: string) => void }>) {
  const [page, setPage] = useState(1);
  const pagination = paginateRows(cases, page);
  return (
    <main className="global-main" aria-labelledby="cases-page-title">
      <header className="global-heading"><p className="eyebrow">Canonical collection</p><h1 id="cases-page-title" data-page-heading tabIndex={-1}>Governed cases</h1><p>Every row is a real Hadal case read from DataHub.</p></header>
      {cases.length === 0 ? <EmptyCases /> : (
        <section className="global-table-panel">
          <table aria-label="Governed cases">
            <thead><tr><th scope="col">Case</th><th scope="col">Change</th><th scope="col">State</th><th scope="col">Updated</th></tr></thead>
            <tbody>{pagination.rows.map((value) => (
              <tr key={value.caseKey}>
                <td><CaseIdentity value={value} onNavigate={onNavigate} /></td>
                <td><code>{value.change.oldName} → {value.change.newName}</code></td>
                <td><StatePill value={value.state} /></td>
                <td><time dateTime={value.updatedAt}>{value.updatedAt}</time></td>
              </tr>
            ))}</tbody>
          </table>
          <Pagination {...pagination} label="Case" onPage={setPage} />
        </section>
      )}
    </main>
  );
}

function WorkPage({ cases, onNavigate }: Readonly<{ cases: readonly ChangeCase[]; onNavigate: (destination: string) => void }>) {
  const [page, setPage] = useState(1);
  const pagination = paginateRows(selectWorkRows(cases), page);
  return (
    <main className="global-main" aria-labelledby="work-page-title">
      <header className="global-heading"><p className="eyebrow">Named accountability</p><h1 id="work-page-title" data-page-heading tabIndex={-1}>Owner work</h1><p>Work items, verified GitHub projections, and validation receipts flattened from real case records.</p></header>
      <section className="global-table-panel">
        <table aria-label="Owner work">
          <thead><tr><th scope="col">Case</th><th scope="col">Work</th><th scope="col">Owner</th><th scope="col">Evidence</th></tr></thead>
          <tbody>{pagination.rows.map((row) => (
            <tr key={`${row.case.caseKey}-${row.work.workKey}`}>
              <td><CaseIdentity value={row.case} onNavigate={onNavigate} /></td>
              <td><strong>{row.work.title}</strong><small>{row.work.kind}</small></td>
              <td><code>{row.work.ownerUrn}</code></td>
              <td>
                {row.projections.map((projection) => <a key={projection.externalId} href={projection.url}>GitHub {projection.externalId}</a>)}
                <span>{row.receipts.length} validation receipt{row.receipts.length === 1 ? "" : "s"}</span>
              </td>
            </tr>
          ))}</tbody>
        </table>
        {pagination.total === 0 && <p className="global-empty-copy">No owner work exists in the canonical case collection.</p>}
        <Pagination {...pagination} label="Work" onPage={setPage} />
      </section>
    </main>
  );
}

function ApprovalsPage({ cases, onNavigate }: Readonly<{ cases: readonly ChangeCase[]; onNavigate: (destination: string) => void }>) {
  const [page, setPage] = useState(1);
  const pagination = paginateRows(selectApprovalRows(cases), page);
  return (
    <main className="global-main" aria-labelledby="approvals-page-title">
      <header className="global-heading"><p className="eyebrow">Human authority</p><h1 id="approvals-page-title" data-page-heading tabIndex={-1}>Governed approvals</h1><p>GitHub decisions are reported here. Pending QVAC mutation gates remain resolvable only inside their case Run page.</p></header>
      <section className="global-table-panel">
        <table aria-label="Governed approvals">
          <thead><tr><th scope="col">Case</th><th scope="col">Gate</th><th scope="col">Authority</th><th scope="col">Recorded outcome</th></tr></thead>
          <tbody>{pagination.rows.map((row) => row.kind === "human" ? (
            <tr key={`${row.case.caseKey}-human-${row.requirement.requirementKey}`}>
              <td><CaseIdentity value={row.case} onNavigate={onNavigate} /></td>
              <td><strong>{row.requirement.role} review</strong><small>{row.requirement.requirementKey}</small></td>
              <td><code>{row.requirement.ownerUrn}</code></td>
              <td>{row.decisions.length === 0 ? <span>Decision required</span> : row.decisions.map((decision) => (
                <div className="recorded-decision" key={`${decision.actorLogin}-${decision.decidedAt}`}>
                  <strong>{decision.verdict}</strong><span>{decision.actorLogin}</span><time dateTime={decision.decidedAt}>{decision.decidedAt}</time>
                  {decision.url !== undefined && <a href={decision.url}>Open GitHub decision</a>}
                </div>
              ))}</td>
            </tr>
          ) : (
            <tr key={`${row.case.caseKey}-qvac-${row.run.runId}`}>
              <td><CaseIdentity value={row.case} onNavigate={onNavigate} /></td>
              <td><strong>{row.pending.toolName}</strong><small>{row.pending.approvalId}</small></td>
              <td><span>Explicit case-scoped operator decision</span></td>
              <td><WorkspaceLink destination={`/workspace/cases/${row.case.caseKey}/run`} onNavigate={onNavigate}>Open QVAC gate</WorkspaceLink></td>
            </tr>
          ))}</tbody>
        </table>
        {pagination.total === 0 && <p className="global-empty-copy">No approval requirements or pending QVAC gates exist in the canonical case collection.</p>}
        <Pagination {...pagination} label="Approval" onPage={setPage} />
      </section>
    </main>
  );
}

export function GlobalPage({ page, cases, onNavigate }: Readonly<{
  page: WorkspacePage;
  cases: readonly ChangeCase[];
  onNavigate: (destination: string) => void;
}>) {
  if (page === "home") return <HomePage cases={cases} onNavigate={onNavigate} />;
  if (page === "cases") return <CasesPage cases={cases} onNavigate={onNavigate} />;
  if (page === "work") return <WorkPage cases={cases} onNavigate={onNavigate} />;
  return <ApprovalsPage cases={cases} onNavigate={onNavigate} />;
}
