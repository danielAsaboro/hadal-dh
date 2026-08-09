import { useEffect, useMemo, useState } from "react";

import { ChangeCaseSchema, type ChangeCase } from "../domain/case";
import { ChangeFlow } from "./ChangeFlow";

export interface WorkspaceClient {
  listCases(): Promise<readonly ChangeCase[]>;
  getCase(caseKey: string): Promise<ChangeCase>;
  sync(caseKey: string): Promise<ChangeCase>;
  reconcile(caseKey: string): Promise<ChangeCase>;
  decide(caseKey: string, targetUrl: string): Promise<ChangeCase>;
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

export function App({ client = httpWorkspaceClient }: { readonly client?: WorkspaceClient }) {
  const [cases, setCases] = useState<readonly ChangeCase[]>([]);
  const [current, setCurrent] = useState<ChangeCase>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

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

        <ChangeFlow value={current} />

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
        </section>
      </main>
    </div>
  );
}
