import { useEffect, useState, type ReactNode } from "react";

import { AgentRunSnapshotSchema, type AgentRunSnapshot } from "../ai/run-events";
import { ChangeCaseSchema, type ChangeCase } from "../domain/case";
import { AppRail, CasePicker, MobileWorkspaceMenu, type RailSessionAction } from "./AppRail";
import { CaseSections, StatePill } from "./CaseSections";
import { ChangeFlow } from "./ChangeFlow";
import { GlobalPage } from "./GlobalPages";
import {
  GovernedAgentPanel,
  type AgentHealth,
  type AgentHealthState,
} from "./GovernedAgentPanel";
import type { AppRoute } from "./routes";

export {
  paginateRows,
  selectApprovalRows,
  selectAttentionCases,
  selectWorkRows,
} from "./workspace-selectors";

export interface WorkspaceClient {
  listCases(): Promise<readonly ChangeCase[]>;
  getCase(caseKey: string): Promise<ChangeCase>;
  sync(caseKey: string): Promise<ChangeCase>;
  reconcile(caseKey: string): Promise<ChangeCase>;
  decide(caseKey: string, targetUrl: string): Promise<ChangeCase>;
  agentHealth(): Promise<AgentHealth>;
  startAgent(caseKey: string, prompt: string): Promise<AgentRunSnapshot>;
  approveAgent(runId: string, token: string, approved: boolean, reason: string): Promise<AgentRunSnapshot>;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const value = await response.json() as unknown;
  if (!response.ok) {
    const message = typeof value === "object" && value !== null && "message" in value
      ? String((value as { message: unknown }).message)
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return value;
}

export const httpWorkspaceClient: WorkspaceClient = {
  listCases: async () => ChangeCaseSchema.array().parse(await request("/api/cases")),
  getCase: async (key) => ChangeCaseSchema.parse(await request(`/api/cases/${key}`)),
  sync: async (key) => ChangeCaseSchema.parse(await request(`/api/cases/${key}/sync`, { method: "POST", body: "{}" })),
  reconcile: async (key) => ChangeCaseSchema.parse(await request(`/api/cases/${key}/reconcile`, { method: "POST", body: "{}" })),
  decide: async (key, targetUrl) => ChangeCaseSchema.parse(await request(`/api/cases/${key}/decide`, {
    method: "POST", body: JSON.stringify({ targetUrl }),
  })),
  agentHealth: async () => await request("/api/agent/health") as AgentHealth,
  startAgent: async (caseKey, prompt) => AgentRunSnapshotSchema.parse(await request("/api/agent/runs", {
    method: "POST", body: JSON.stringify({ caseKey, prompt }),
  })),
  approveAgent: async (runId, token, approved, reason) => AgentRunSnapshotSchema.parse(await request(
    `/api/agent/runs/${runId}/approvals/${token}`,
    { method: "POST", body: JSON.stringify({ approved, reason }) },
  )),
};

function messageFrom(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

type AuthenticatedWorkspaceRoute = Exclude<AppRoute, { kind: "landing" | "public-not-found" | "case-redirect" }>;

export function Workspace({ client = httpWorkspaceClient, sessionAction, route, onNavigate }: Readonly<{
  client?: WorkspaceClient;
  sessionAction?: RailSessionAction;
  route: AuthenticatedWorkspaceRoute;
  onNavigate: (destination: string) => void;
}>) {
  const [cases, setCases] = useState<readonly ChangeCase[]>([]);
  const [retainedCase, setRetainedCase] = useState<ChangeCase>();
  const [loading, setLoading] = useState(true);
  const [caseLoadError, setCaseLoadError] = useState<string>();
  const [caseLoadKey, setCaseLoadKey] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [agentHealth, setAgentHealth] = useState<AgentHealthState>({ status: "checking" });
  const [healthKey, setHealthKey] = useState(0);
  const [agentRun, setAgentRun] = useState<AgentRunSnapshot>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    void client.listCases().then((values) => {
      if (!active) return;
      setCases(values);
      setRetainedCase(values[0]);
      setCaseLoadError(undefined);
      setLoading(false);
    }).catch((caught: unknown) => {
      if (!active) return;
      setCaseLoadError(messageFrom(caught, "Could not load governed cases"));
      setLoading(false);
    });
    return () => { active = false; };
  }, [caseLoadKey, client]);

  const current = route.kind === "case"
    ? cases.find((item) => item.caseKey === route.caseKey)
    : retainedCase;

  useEffect(() => {
    let active = true;
    setAgentHealth((existing) => existing.status === "unavailable"
      ? { status: "checking", previousFailure: existing.message }
      : { status: "checking" });
    void client.agentHealth().then((value) => {
      if (active) setAgentHealth({ status: "available", value });
    }).catch((caught: unknown) => {
      if (active) setAgentHealth({ status: "unavailable", message: messageFrom(caught, "QVAC health check did not complete") });
    });
    return () => { active = false; };
  }, [client, healthKey]);

  const updateCase = (value: ChangeCase) => {
    setRetainedCase(value);
    setCases((existing) => existing.map((item) => item.caseKey === value.caseKey ? value : item));
  };

  const mutate = async (label: string, action: () => Promise<ChangeCase>) => {
    setBusy(label);
    setError(undefined);
    try {
      updateCase(await action());
    } catch (caught) {
      setError(messageFrom(caught, "Operation failed without verified completion"));
    } finally {
      setBusy(undefined);
    }
  };

  const selectCase = async (caseKey: string) => {
    setBusy("case");
    setError(undefined);
    try {
      const selected = await client.getCase(caseKey);
      setRetainedCase(selected);
      setCases((existing) => existing.map((item) => item.caseKey === selected.caseKey ? selected : item));
      onNavigate(`/workspace/cases/${selected.caseKey}/overview`);
    } catch (caught) {
      setError(messageFrom(caught, "Case selection failed without a verified DataHub reread"));
    } finally {
      setBusy(undefined);
    }
  };

  const coordinate = async (prompt: string) => {
    if (current === undefined || agentHealth.status !== "available") return;
    setBusy("agent");
    setError(undefined);
    try {
      setAgentRun(await client.startAgent(current.caseKey, prompt));
    } catch (caught) {
      setError(messageFrom(caught, "QVAC run failed without verified completion"));
    } finally {
      setBusy(undefined);
    }
  };

  const resolveAgentApproval = async (approved: boolean) => {
    const pending = agentRun?.pendingApproval;
    const runCase = agentRun === undefined ? undefined : cases.find((item) => item.caseKey === agentRun.caseKey);
    if (agentRun === undefined || pending === undefined || runCase === undefined) return;
    setBusy("agent-approval");
    setError(undefined);
    try {
      setAgentRun(await client.approveAgent(
        agentRun.runId,
        pending.token,
        approved,
        approved ? "Approved in ChangeMarshal command center" : "Denied in ChangeMarshal command center",
      ));
      const reread = await client.getCase(runCase.caseKey);
      setCases((existing) => existing.map((item) => item.caseKey === reread.caseKey ? reread : item));
      setRetainedCase((selected) => selected?.caseKey === reread.caseKey ? reread : selected);
    } catch (caught) {
      setError(messageFrom(caught, "Agent approval did not complete"));
    } finally {
      setBusy(undefined);
    }
  };

  if (loading) {
    return (
      <main className="center-state" role="status" aria-label="Governed case loading status">
        <p>Loading governed cases…</p>
        {caseLoadError !== undefined && <div role="alert"><strong>Last DataHub case load failure.</strong> {caseLoadError}</div>}
      </main>
    );
  }
  if (caseLoadError !== undefined) {
    return (
      <main className="center-state">
        <div role="alert">
          <p><strong>DataHub case load failed.</strong> {caseLoadError}</p>
          <button onClick={() => setCaseLoadKey((value) => value + 1)}>Retry governed case load</button>
        </div>
      </main>
    );
  }
  const renderShell = (content: ReactNode) => (
    <div className="workspace-shell">
      <AppRail
        route={route}
        onNavigate={onNavigate}
        disabled={busy !== undefined}
        {...(sessionAction === undefined ? {} : { sessionAction })}
      />
      <div className="workspace-content">
        <header className="workspace-context">
          <MobileWorkspaceMenu
            route={route}
            onNavigate={onNavigate}
            disabled={busy !== undefined}
            {...(sessionAction === undefined ? {} : { sessionAction })}
          />
          <div className="context-copy">
            <span>Canonical operations</span>
            <strong>{route.kind === "case" && current !== undefined ? `${current.repository} · ${current.change.modelName}` : "All governed cases"}</strong>
          </div>
          <CasePicker cases={cases} disabled={busy !== undefined} onOpenCase={selectCase} />
        </header>
        {error && <div className="shell-error error-banner" role="alert"><strong>Not verified.</strong> {error}</div>}
        {content}
      </div>
    </div>
  );

  if (route.kind === "workspace") return renderShell(<GlobalPage page={route.page} cases={cases} onNavigate={onNavigate} />);
  if (current === undefined) {
    return renderShell(
      <main className="case-main center-state" aria-labelledby="case-not-found-title">
        <div>
          <h1 id="case-not-found-title">Case not found</h1>
          <p>The requested governed case is not available from the canonical DataHub case collection.</p>
        </div>
      </main>,
    );
  }

  const runCase = agentRun === undefined ? undefined : cases.find((item) => item.caseKey === agentRun.caseKey);
  const visibleRun = runCase === undefined ? undefined : agentRun;
  const actionStatus = busy === "sync"
    ? "Syncing owner work…"
    : busy === "reconcile"
      ? "Reconciling GitHub…"
      : busy === "decide"
        ? "Verifying merge decision…"
        : busy === undefined
          ? "Case actions ready"
          : "Another governed operation is in progress…";

  return (
    renderShell(
      <main className="case-main" aria-labelledby="case-title">
        <header className="case-header" id="overview">
          <div>
            <p className="eyebrow">{current.repository} · {current.caseKey}</p>
            <h1 id="case-title">{current.change.modelName} governed change</h1>
            <p className="change-line" aria-label={`${current.change.oldName} → ${current.change.newName}`}><code>{current.change.oldName}</code><span>→</span><code>{current.change.newName}</code></p>
          </div>
          <div className="header-state"><StatePill value={current.state} /><span className="sha">{current.revision.headSha}</span></div>
        </header>

        <nav className="case-sections" aria-label="Case sections">
          <a href="#overview">Overview</a><a href="#execution-graph">Graph</a><a href="#work">Work</a>
          <a href="#approvals">Approvals</a><a href="#evidence">Evidence</a><a href="#history">History</a>
        </nav>

        <span className="sr-only" role="status" aria-label="Case action status" aria-live="polite">{actionStatus}</span>
        <section className="command-bar" aria-label="Case actions" aria-busy={busy !== undefined}>
          <button disabled={busy !== undefined} onClick={() => void mutate("sync", () => client.sync(current.caseKey))}>{busy === "sync" ? "Syncing owner work…" : "Sync owner work"}</button>
          <button disabled={busy !== undefined} onClick={() => void mutate("reconcile", () => client.reconcile(current.caseKey))}>{busy === "reconcile" ? "Reconciling GitHub…" : "Reconcile GitHub"}</button>
          <button className="primary-action" disabled={busy !== undefined} onClick={() => void mutate("decide", () => client.decide(current.caseKey, window.location.href))}>
            {busy === "decide" ? "Verifying…" : "Evaluate merge"}
          </button>
        </section>

        <GovernedAgentPanel
          value={runCase ?? current}
          health={agentHealth}
          {...(visibleRun === undefined ? {} : { run: visibleRun })}
          {...(busy === undefined ? {} : { busy })}
          onRun={(prompt) => void coordinate(prompt)}
          onResolveApproval={(approved) => void resolveAgentApproval(approved)}
          onRetryHealth={() => setHealthKey((value) => value + 1)}
        />

        <ChangeFlow value={current} {...(visibleRun?.caseKey === current.caseKey ? { run: visibleRun } : {})} />
        <CaseSections value={current} />
      </main>,
    )
  );
}
