import { useEffect, useMemo, useState } from "react";

import { AgentRunSnapshotSchema, type AgentRunSnapshot } from "../ai/run-events";
import { ChangeCaseSchema, type ChangeCase } from "../domain/case";
import { ChangeFlow } from "./ChangeFlow";
import { LandingPage } from "./LandingPage";
import { SignInPage } from "./SignInPage";
import { httpSessionClient, type SessionClient, type SessionState } from "./session-client";

type AgentHealth = Readonly<{ available: true; provider: "qvac"; modelId: string; managed: boolean }>;

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

function shortUrn(urn: string): string {
  if (urn.includes(",")) return urn.split(",").at(-2)?.split(".").at(-1) ?? urn;
  return urn.split(":").at(-1) ?? urn;
}

function StatePill({ value }: { readonly value: string }) {
  return <span className={`state-pill state-${value.replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

function Empty({ children }: { readonly children: string }) {
  return <p className="empty-state">{children}</p>;
}

export function Workspace({ client = httpWorkspaceClient }: { readonly client?: WorkspaceClient }) {
  const [cases, setCases] = useState<readonly ChangeCase[]>([]);
  const [current, setCurrent] = useState<ChangeCase>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [agentHealth, setAgentHealth] = useState<AgentHealth>();
  const [agentRun, setAgentRun] = useState<AgentRunSnapshot>();
  const [agentPrompt, setAgentPrompt] = useState("Call readCase for this exact governed case. Then call generateRemediation for that exact case once to create its compatibility remediation. Do not call any other mutating tool. After its verified result, summarize and stop.");

  useEffect(() => {
    let active = true;
    void client.listCases().then((values) => {
      if (!active) return;
      setCases(values);
      setCurrent(values[0]);
      setLoading(false);
    }).catch((caught: unknown) => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : "Could not load governed cases");
      setLoading(false);
    });
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    let active = true;
    void client.agentHealth().then((value) => { if (active) setAgentHealth(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [client]);

  const decisions = useMemo(() => new Map(current?.approvalDecisions.map((item) => [item.requirementKey, item])), [current]);
  const projections = useMemo(() => new Map(current?.externalProjections.map((item) => [item.workKey, item])), [current]);
  const receipts = useMemo(() => new Map(current?.validationReceipts.map((item) => [item.workKey, item])), [current]);

  const mutate = async (label: string, action: () => Promise<ChangeCase>) => {
    setBusy(label);
    setError(undefined);
    try {
      const value = await action();
      setCurrent(value);
      setCases((existing) => existing.map((item) => item.caseKey === value.caseKey ? value : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Operation failed without verified completion");
    } finally {
      setBusy(undefined);
    }
  };

  const coordinate = async () => {
    if (current === undefined || agentHealth === undefined) return;
    setBusy("agent");
    setError(undefined);
    try {
      setAgentRun(await client.startAgent(current.caseKey, agentPrompt));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "QVAC run failed without verified completion");
    } finally {
      setBusy(undefined);
    }
  };

  const resolveAgentApproval = async (approved: boolean) => {
    const pending = agentRun?.pendingApproval;
    if (current === undefined || agentRun === undefined || pending === undefined) return;
    setBusy("agent-approval");
    setError(undefined);
    try {
      setAgentRun(await client.approveAgent(
        agentRun.runId, pending.token, approved,
        approved ? "Approved in ChangeMarshal command center" : "Denied in ChangeMarshal command center",
      ));
      setCurrent(await client.getCase(current.caseKey));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Agent approval did not complete");
    } finally {
      setBusy(undefined);
    }
  };

  if (loading) return <main className="center-state">Loading governed cases…</main>;
  if (current === undefined) return <main className="center-state">{error ?? "No governed ChangeMarshal cases exist in DataHub."}</main>;

  const blockers = current.admission?.blockers ?? ["ADMISSION_NOT_EVALUATED"];
  return (
    <div className="workspace-shell">
      <aside className="case-rail" aria-label="Change cases">
        <div className="brand-lockup"><span className="cut-mark">CM/</span><span>ChangeMarshal</span></div>
        <p className="rail-label">Governed changes</p>
        <nav>
          {cases.map((item) => (
            <button className={item.caseKey === current.caseKey ? "case-link active" : "case-link"} key={item.caseKey}
              onClick={() => void client.getCase(item.caseKey).then(setCurrent)}>
              <span>{item.change.modelName}</span>
              <small>{item.caseKey.slice(0, 8)}</small>
            </button>
          ))}
        </nav>
        <div className="rail-foot"><span className="pulse-dot" /> DataHub canonical</div>
      </aside>

      <main className="case-main">
        <header className="case-header">
          <div>
            <p className="eyebrow">{current.repository} · {current.caseKey.slice(0, 8)}</p>
            <h1>{current.change.modelName} governed change</h1>
            <p className="change-line" aria-label={`${current.change.oldName} → ${current.change.newName}`}><code>{current.change.oldName}</code><span>→</span><code>{current.change.newName}</code></p>
          </div>
          <div className="header-state"><StatePill value={current.state} /><span className="sha">{current.revision.headSha.slice(0, 10)}</span></div>
        </header>

        {error && <div className="error-banner" role="alert"><strong>Not verified.</strong> {error}</div>}

        <section className="command-bar" aria-label="Case actions">
          <button disabled={busy !== undefined} onClick={() => void mutate("sync", () => client.sync(current.caseKey))}>Sync owner work</button>
          <button disabled={busy !== undefined} onClick={() => void mutate("reconcile", () => client.reconcile(current.caseKey))}>Reconcile GitHub</button>
          <button className="primary-action" disabled={busy !== undefined} onClick={() => void mutate("decide", () => client.decide(current.caseKey, window.location.href))}>
            {busy === "decide" ? "Verifying…" : "Evaluate merge"}
          </button>
        </section>

        <section className="agent-console" aria-label="QVAC coordination controls">
          <div className="agent-console-copy">
            <p className="eyebrow">Local AI · governed tools</p>
            <h2>{agentHealth === undefined ? "QVAC runtime unavailable" : `${agentHealth.modelId} coordinator`}</h2>
            <textarea aria-label="QVAC coordination request" value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} rows={3} />
          </div>
          <button className="agent-run-button" disabled={busy !== undefined || agentHealth === undefined || agentPrompt.trim().length === 0} onClick={() => void coordinate()}>
            {busy === "agent" ? "Running real model…" : "Run QVAC coordinator"}
          </button>
          {agentRun?.pendingApproval && <div className="agent-approval-card" role="group" aria-label={`Approval required for ${agentRun.pendingApproval.toolName}`}>
            <div><p className="eyebrow">Human mutation gate</p><h3>{agentRun.pendingApproval.toolName}</h3><p>Exact arguments hash <code>{agentRun.pendingApproval.argumentsHash.slice(0, 16)}…</code> · head <code>{agentRun.headSha.slice(0, 10)}</code></p></div>
            <div className="agent-approval-buttons">
              <button disabled={busy !== undefined} onClick={() => void resolveAgentApproval(false)}>Deny {agentRun.pendingApproval.toolName}</button>
              <button className="primary-action" disabled={busy !== undefined} onClick={() => void resolveAgentApproval(true)}>Approve {agentRun.pendingApproval.toolName}</button>
            </div>
          </div>}
          {agentRun?.answer && <article className="agent-answer"><p className="eyebrow">Grounded model response</p><p>{agentRun.answer}</p></article>}
          {agentRun && <ol className="agent-events" aria-label="Agent audit events">{agentRun.events.map((event) => <li key={event.sequence}><span>{String(event.sequence).padStart(2, "0")}</span><strong>{event.kind.replaceAll("_", " ")}</strong><small>{event.summary}</small></li>)}</ol>}
        </section>

        <ChangeFlow value={current} {...(agentRun === undefined ? {} : { run: agentRun })} />

        <section className="metric-grid" aria-label="Case summary">
          <article><span>Graph paths</span><strong>{current.evidence.paths.length}</strong></article>
          <article><span>Owners engaged</span><strong>{new Set(current.workItems.map((item) => item.ownerUrn)).size}</strong></article>
          <article><span>Verified work</span><strong>{current.externalProjections.filter((item) => item.state === "verified").length}/{current.workItems.length}</strong></article>
          <article className={blockers.length ? "metric-alert" : "metric-clear"}><span>Merge blockers</span><strong>{blockers.length}</strong></article>
        </section>

        <section className="panel blockers-panel">
          <div className="section-heading"><div><p className="eyebrow">Deterministic policy</p><h2>Merge authority</h2></div><StatePill value={current.admission?.allowed ? "allowed" : "blocked"} /></div>
          {blockers.length === 0 ? <Empty>Every governed requirement is verified for this Git head.</Empty> : (
            <ul className="blocker-list">{blockers.map((blocker) => <li key={blocker}><span>!</span><code>{blocker}</code></li>)}</ul>
          )}
        </section>

        <div className="two-column">
          <section className="panel" id="work">
            <div className="section-heading"><div><p className="eyebrow">Accountable execution</p><h2>Owner work</h2></div><span className="count">{current.workItems.length}</span></div>
            {current.workItems.length === 0 ? <Empty>No work can be derived until graph evidence and ownership are complete.</Empty> : (
              <div className="work-stack">{current.workItems.map((work) => {
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
            <div className="section-heading"><div><p className="eyebrow">SHA-bound decisions</p><h2>Approvals</h2></div><span className="count">{current.approvalRequirements.length}</span></div>
            <div className="approval-stack">{current.approvalRequirements.map((requirement) => {
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
          <div className="section-heading"><div><p className="eyebrow">DataHub graph proof</p><h2>Exact impact paths</h2></div><span className="count">{current.evidence.paths.length}</span></div>
          {current.evidence.paths.length === 0 ? <Empty>No downstream paths were returned in the complete evidence set.</Empty> : (
            <div className="path-stack">{current.evidence.paths.map((path, index) => <article className="path-row" key={`${path.downstreamUrn}-${index}`}>
              <span className="path-index">{String(index + 1).padStart(2, "0")}</span>
              <div className="node-chain">{path.nodes.map((node, nodeIndex) => <span key={`${node}-${nodeIndex}`}><b>{shortUrn(node)}</b>{nodeIndex < path.nodes.length - 1 && <i>→</i>}</span>)}</div>
              <code>{path.column}{path.downstreamColumns.length ? ` → ${path.downstreamColumns.join(", ")}` : ""}</code>
            </article>)}</div>
          )}
        </section>

        <section className="panel" id="history">
          <div className="section-heading"><div><p className="eyebrow">Durable resolution history</p><h2>Verified timeline</h2></div></div>
          <ol className="timeline">
            <li><time>{current.createdAt}</time><strong>Case created</strong><span>Git evidence bound to {current.revision.headSha.slice(0, 10)}</span></li>
            {current.approvalDecisions.map((decision) => <li key={decision.requirementKey}><time>{decision.decidedAt}</time><strong>{decision.role} {decision.verdict}</strong><span>Verified GitHub actor {decision.actorLogin}</span></li>)}
            {current.validationReceipts.map((receipt) => <li key={receipt.receiptKey}><time>{receipt.finishedAt}</time><strong>Validation {receipt.valid ? "passed" : "failed"}</strong><span>Receipt {receipt.receiptKey.slice(0, 8)}</span></li>)}
            {current.dataHub.verified && current.dataHub.verifiedAt && current.dataHub.documentUrn && <li><time>{current.dataHub.verifiedAt}</time><strong>DataHub reread verified</strong><span>{shortUrn(current.dataHub.documentUrn)}</span></li>}
          </ol>
          {current.agentRuns.length > 0 && <>
            <h3 className="history-subheading">Agent execution audit</h3>
            <ol className="timeline agent-audit-timeline" aria-label="Durable agent audit">
              {current.agentRuns.flatMap((run) => run.events.map((event) => <li key={`${run.runId}-${event.sequence}`}>
                <time>{event.at}</time>
                <strong>{event.kind.replaceAll("_", " ")}</strong>
                <span>{run.modelId} · {event.summary}</span>
              </li>))}
            </ol>
          </>}
        </section>
      </main>
    </div>
  );
}

type AppPath = "/" | "/workspace";

interface AppProps {
  readonly client?: WorkspaceClient;
  readonly sessionClient?: SessionClient;
  readonly initialPath?: string;
}

function appPath(pathname: string): AppPath {
  return pathname === "/workspace" ? "/workspace" : "/";
}

function WorkspaceGate({ client, sessionClient }: {
  readonly client: WorkspaceClient;
  readonly sessionClient: SessionClient;
}) {
  const [session, setSession] = useState<SessionState>();
  const [error, setError] = useState<string>();
  const [readKey, setReadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setSession(undefined);
    setError(undefined);
    void sessionClient.read().then((value) => {
      if (active) setSession(value);
    }).catch((caught: unknown) => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : "Could not verify the operator session");
    });
    return () => { active = false; };
  }, [readKey, sessionClient]);

  if (error !== undefined) {
    return (
      <main className="center-state">
        <div role="alert">
          <p>Session verification failed. {error}</p>
          <button onClick={() => setReadKey((value) => value + 1)}>Retry session check</button>
        </div>
      </main>
    );
  }
  if (session === undefined) return <main className="center-state" role="status">Verifying operator session…</main>;
  if (session.configured && !session.authenticated) {
    return <SignInPage
      onSignIn={async (passphrase) => {
        await sessionClient.signIn(passphrase);
        const verified = await sessionClient.read();
        if (!verified.authenticated) throw new Error("The session could not be verified");
        setSession(verified);
      }}
    />;
  }
  return (
    <>
      {!session.configured && <p className="local-session-label" role="status">Local operator session · authentication not configured</p>}
      <Workspace client={client} />
    </>
  );
}

export function App({
  client = httpWorkspaceClient,
  sessionClient = httpSessionClient,
  initialPath,
}: AppProps) {
  const [path, setPath] = useState<AppPath>(() => appPath(initialPath ?? window.location.pathname));

  useEffect(() => {
    const onPopState = () => setPath(appPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (destination: AppPath) => {
    window.history.pushState({}, "", destination);
    setPath(destination);
  };

  if (path === "/") return <LandingPage onEnterWorkspace={() => navigate("/workspace")} />;
  return <WorkspaceGate client={client} sessionClient={sessionClient} />;
}
