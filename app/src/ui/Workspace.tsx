import { useEffect, useState, type ReactNode } from "react";

import { AgentRunSnapshotSchema, type AgentRunSnapshot } from "../ai/run-events";
import type { DurableAgentRun } from "../domain/agent-audit";
import { ChangeCaseSchema, type ChangeCase } from "../domain/case";
import { AppRail, CasePicker, MobileWorkspaceMenu, type RailSessionAction } from "./AppRail";
import { CasePage } from "./CasePage";
import { GlobalPage } from "./GlobalPages";
import type { AgentHealth, AgentHealthState, AgentRunRehydrationState } from "./GovernedAgentPanel";
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
  getAgentRun?(runId: string): Promise<AgentRunSnapshot>;
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
  getAgentRun: async (runId) => AgentRunSnapshotSchema.parse(await request(`/api/agent/runs/${runId}`)),
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

type AuthenticatedWorkspaceRoute = Exclude<AppRoute, { kind: "landing" | "public-not-found" | "case-redirect" | "workspace-not-found" }>;

function latestDurablePendingRun(value: ChangeCase): DurableAgentRun | undefined {
  return [...value.agentRuns]
    .filter((run) => run.status === "waiting_for_approval" && run.pendingApproval !== undefined)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.runId.localeCompare(right.runId))[0];
}

function verifyRehydratedRun(snapshot: AgentRunSnapshot, durable: DurableAgentRun): void {
  if (snapshot.runId !== durable.runId || snapshot.caseKey !== durable.caseKey || snapshot.headSha !== durable.headSha) {
    throw new Error("The recovered coordinator run did not match the durable case, run ID, and immutable Git head");
  }
  if (snapshot.status !== "waiting_for_approval") return;
  const pending = snapshot.pendingApproval;
  const durablePending = durable.pendingApproval;
  if (
    pending === undefined
    || durablePending === undefined
    || pending.approvalId !== durablePending.approvalId
    || pending.toolCallId !== durablePending.toolCallId
    || pending.toolName !== durablePending.toolName
    || pending.argumentsHash !== durablePending.argumentsHash
    || pending.requestedAt !== durablePending.requestedAt
    || pending.expiresAt !== durablePending.expiresAt
  ) throw new Error("The recovered approval token was not bound to the exact durable pending scope");
}

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
  const [agentRunsByCase, setAgentRunsByCase] = useState<Record<string, AgentRunSnapshot | undefined>>({});
  const [runRehydrationByCase, setRunRehydrationByCase] = useState<Record<string, AgentRunRehydrationState | undefined>>({});
  const runRouteActive = route.kind === "case" && route.page === "run";

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
  const currentCaseKey = current?.caseKey;
  const visibleRun = currentCaseKey === undefined ? undefined : agentRunsByCase[currentCaseKey];
  const durablePendingRun = current === undefined ? undefined : latestDurablePendingRun(current);
  const visibleRunRehydration = currentCaseKey === undefined ? undefined : runRehydrationByCase[currentCaseKey];

  useEffect(() => setError(undefined), [route]);

  useEffect(() => {
    if (loading) return;
    document.querySelector<HTMLElement>(".workspace-content [data-page-heading]")?.focus({ preventScroll: true });
  }, [loading, route, currentCaseKey]);

  useEffect(() => {
    if (!runRouteActive) return;
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
  }, [client, healthKey, runRouteActive]);

  useEffect(() => {
    if (!runRouteActive || currentCaseKey === undefined || durablePendingRun === undefined || visibleRun !== undefined) return;
    let active = true;
    const unavailable = (message: string) => {
      if (!active) return;
      setRunRehydrationByCase((existing) => ({
        ...existing,
        [currentCaseKey]: { status: "unavailable", run: durablePendingRun, message },
      }));
    };
    setRunRehydrationByCase((existing) => ({
      ...existing,
      [currentCaseKey]: { status: "loading", runId: durablePendingRun.runId },
    }));
    if (client.getAgentRun === undefined) {
      unavailable("This workspace client cannot retrieve the exact run snapshot.");
      return () => { active = false; };
    }
    void client.getAgentRun(durablePendingRun.runId).then((snapshot) => {
      if (!active) return;
      verifyRehydratedRun(snapshot, durablePendingRun);
      setAgentRunsByCase((existing) => ({ ...existing, [currentCaseKey]: snapshot }));
      setRunRehydrationByCase((existing) => ({ ...existing, [currentCaseKey]: undefined }));
    }).catch((caught: unknown) => {
      unavailable(messageFrom(caught, "The exact coordinator state and approval token are unavailable."));
    });
    return () => { active = false; };
  }, [client, currentCaseKey, durablePendingRun, runRouteActive, visibleRun]);

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
    const caseKey = current.caseKey;
    setBusy("agent");
    setError(undefined);
    try {
      const started = await client.startAgent(caseKey, prompt);
      if (started.caseKey !== caseKey) throw new Error("QVAC returned a run for a different governed case");
      setAgentRunsByCase((existing) => ({ ...existing, [caseKey]: started }));
    } catch (caught) {
      setError(messageFrom(caught, "QVAC run failed without verified completion"));
    } finally {
      setBusy(undefined);
    }
  };

  const resolveAgentApproval = async (caseKey: string, approved: boolean) => {
    const agentRun = agentRunsByCase[caseKey];
    const pending = agentRun?.pendingApproval;
    const runCase = cases.find((item) => item.caseKey === caseKey);
    if (agentRun === undefined || pending === undefined || runCase === undefined || agentRun.caseKey !== caseKey) return;
    setBusy("agent-approval");
    setError(undefined);
    try {
      const resolved = await client.approveAgent(
        agentRun.runId,
        pending.token,
        approved,
        approved ? "Approved in Hadal command center" : "Denied in Hadal command center",
      );
      if (resolved.runId !== agentRun.runId || resolved.caseKey !== caseKey) {
        throw new Error("QVAC returned an approval result outside the exact governed run scope");
      }
      setAgentRunsByCase((existing) => ({ ...existing, [caseKey]: resolved }));
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
          {route.kind !== "case" && <CasePicker cases={cases} disabled={busy !== undefined} onOpenCase={selectCase} />}
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
          <h1 id="case-not-found-title" data-page-heading tabIndex={-1}>Case not found</h1>
          <p>The requested governed case is not available from the canonical DataHub case collection.</p>
        </div>
      </main>,
    );
  }

  const actionStatus = busy === "sync"
    ? "Syncing owner work…"
    : busy === "reconcile"
      ? "Reconciling GitHub…"
      : busy === "decide"
        ? "Verifying merge decision…"
        : busy === undefined
          ? "Case actions ready"
          : "Another governed operation is in progress…";

  return renderShell(
    <CasePage
      value={current}
      cases={cases}
      page={route.page}
      {...(busy === undefined ? {} : { busy })}
      actionStatus={actionStatus}
      health={agentHealth}
      {...(visibleRun === undefined ? {} : { run: visibleRun })}
      {...(visibleRunRehydration === undefined ? {} : { runRehydration: visibleRunRehydration })}
      onNavigate={onNavigate}
      onOpenCase={selectCase}
      onSync={() => void mutate("sync", () => client.sync(current.caseKey))}
      onReconcile={() => void mutate("reconcile", () => client.reconcile(current.caseKey))}
      onEvaluate={() => void mutate("decide", () => client.decide(current.caseKey, window.location.href))}
      onRun={(prompt) => void coordinate(prompt)}
      onResolveApproval={(approved) => void resolveAgentApproval(current.caseKey, approved)}
      onRetryHealth={() => setHealthKey((value) => value + 1)}
    />,
  );
}
