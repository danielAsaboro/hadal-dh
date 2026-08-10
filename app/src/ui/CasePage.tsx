import { lazy, Suspense } from "react";

import type { AgentRunSnapshot } from "../ai/run-events";
import type { ChangeCase } from "../domain/case";
import { CasePicker, WorkspaceLink } from "./AppRail";
import {
  CaseApprovals,
  CaseHistory,
  CaseOverview,
  CaseWork,
  StatePill,
} from "./CaseSections";
import { GovernedAgentPanel, type AgentHealthState, type AgentRunRehydrationState } from "./GovernedAgentPanel";
import { casePages, type CasePage as CasePageName } from "./routes";

const GraphPage = lazy(() => import("./GraphPage"));

const pageLabels: Readonly<Record<CasePageName, string>> = {
  overview: "Overview",
  graph: "Graph",
  work: "Work",
  approvals: "Approvals",
  run: "Run",
  history: "History",
};

function CaseIdentity({ value, cases, page, busy, onNavigate, onOpenCase }: Readonly<{
  value: ChangeCase;
  cases: readonly ChangeCase[];
  page: CasePageName;
  busy?: string;
  onNavigate: (destination: string) => void;
  onOpenCase: (caseKey: string) => Promise<void>;
}>) {
  return (
    <section className="case-identity" aria-labelledby="case-title">
      <div className="case-identity-topline">
        <nav aria-label="Case breadcrumb">
          <WorkspaceLink destination="/workspace/cases" onNavigate={onNavigate}>Cases</WorkspaceLink>
          <span aria-hidden="true">/</span>
          <span>{value.change.modelName}</span>
          <span aria-hidden="true">/</span>
          <span>{pageLabels[page]}</span>
        </nav>
        <CasePicker cases={cases} disabled={busy !== undefined} onOpenCase={onOpenCase} />
      </div>

      <header className="case-header">
        <div>
          <p className="eyebrow">{value.repository} · {value.caseKey}</p>
          <h1 id="case-title" data-page-heading tabIndex={-1}>{value.change.modelName} governed change</h1>
          <p className="change-line" aria-label={`${value.change.oldName} → ${value.change.newName}`}><code>{value.change.oldName}</code><span>→</span><code>{value.change.newName}</code></p>
        </div>
        <div className="header-state">
          <StatePill value={value.state} />
          <span className="identity-fact"><small>Immutable SHA</small><code className="sha">{value.revision.headSha}</code></span>
          <span className={`identity-fact datahub-verification ${value.dataHub.verified ? "verified" : "pending"}`}>
            <small>DataHub</small>
            <strong>{value.dataHub.verified ? "Reread verified" : "Verification pending"}</strong>
          </span>
        </div>
      </header>

      <nav className="case-sections" aria-label="Case pages">
        {casePages.map((target) => (
          <WorkspaceLink
            current={page === target}
            destination={`/workspace/cases/${value.caseKey}/${target}`}
            key={target}
            onNavigate={onNavigate}
          >
            {pageLabels[target]}
          </WorkspaceLink>
        ))}
      </nav>
    </section>
  );
}

export function CasePage({
  value,
  cases,
  page,
  busy,
  actionStatus,
  health,
  run,
  runRehydration,
  onNavigate,
  onOpenCase,
  onSync,
  onReconcile,
  onEvaluate,
  onRun,
  onResolveApproval,
  onRetryHealth,
}: Readonly<{
  value: ChangeCase;
  cases: readonly ChangeCase[];
  page: CasePageName;
  busy?: string;
  actionStatus: string;
  health: AgentHealthState;
  run?: AgentRunSnapshot;
  runRehydration?: AgentRunRehydrationState;
  onNavigate: (destination: string) => void;
  onOpenCase: (caseKey: string) => Promise<void>;
  onSync: () => void;
  onReconcile: () => void;
  onEvaluate: () => void;
  onRun: (prompt: string) => void;
  onResolveApproval: (approved: boolean) => void;
  onRetryHealth: () => void;
}>) {
  return (
    <main className="case-main" aria-labelledby="case-title">
      <CaseIdentity
        value={value}
        cases={cases}
        page={page}
        {...(busy === undefined ? {} : { busy })}
        onNavigate={onNavigate}
        onOpenCase={onOpenCase}
      />
      {page === "overview" && (
        <CaseOverview
          value={value}
          {...(busy === undefined ? {} : { busy })}
          actionStatus={actionStatus}
          onSync={onSync}
          onReconcile={onReconcile}
          onEvaluate={onEvaluate}
        />
      )}
      {page === "graph" && (
        <Suspense fallback={(
          <div className="case-page graph-loading-state" role="status" aria-label="Governed graph loading status">
            Loading governed execution graph…
          </div>
        )}>
          <GraphPage value={value} {...(run === undefined ? {} : { run })} />
        </Suspense>
      )}
      {page === "work" && <CaseWork value={value} />}
      {page === "approvals" && <CaseApprovals value={value} />}
      {page === "run" && (
        <div className="case-page case-run-page">
          <GovernedAgentPanel
            value={value}
            health={health}
            {...(run === undefined ? {} : { run })}
            {...(runRehydration === undefined ? {} : { rehydration: runRehydration })}
            {...(busy === undefined ? {} : { busy })}
            onRun={onRun}
            onResolveApproval={onResolveApproval}
            onRetryHealth={onRetryHealth}
          />
        </div>
      )}
      {page === "history" && <CaseHistory value={value} />}
    </main>
  );
}
