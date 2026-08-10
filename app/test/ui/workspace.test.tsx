// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentRunSnapshot } from "../../src/ai/run-events";
import type { ChangeCase, ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import { App, type WorkspaceClient } from "../../src/ui/App";

class TestResizeObserver implements ResizeObserver {
  readonly observe = () => undefined;
  readonly unobserve = () => undefined;
  readonly disconnect = () => undefined;
}
globalThis.ResizeObserver = TestResizeObserver;
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

const localSessionClient = {
  read: async () => ({ configured: false, authenticated: true }),
  signIn: async (_passphrase: string) => undefined,
  signOut: async () => undefined,
};

function caseValue(): ChangeCase {
  const source = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
  const consumer = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.orders,PROD)";
  const evidence: ImpactEvidence = {
    complete: true,
    source: { urn: source, type: "dataset", name: "customers" }, schemaFields: ["email"],
    paths: [{ sourceUrn: source, downstreamUrn: consumer, column: "email", downstreamColumns: ["email"], nodes: [source, consumer] }],
    assets: [
      { urn: source, type: "dataset", name: "customers", owners: ["urn:li:corpuser:producer"], tags: ["urn:li:tag:PII"], glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete: true },
      { urn: consumer, type: "dataset", name: "orders", owners: ["urn:li:corpuser:consumer"], tags: [], glossaryTerms: [], incidentStatuses: ["WARN"], assertions: [], queries: [], complete: true },
    ],
  };
  const value = compileCase(evidence, {
    repository: "acme/warehouse", baseSha: "base", headSha: "head", observedAt: "2026-08-09T10:00:00.000Z",
    change: { kind: "dbt_column_rename", modelName: "customers", oldName: "email", newName: "email_address", sourcePath: "models/schema.yml" },
  });
  const work = value.workItems[0]!;
  return {
    ...value,
    admission: { allowed: false, blockers: ["OWNER_MAPPING_MISSING:urn:li:corpuser:producer"], revisionKey: value.revision.revisionKey, headSha: "head", evaluatedAt: "2026-08-09T10:01:00.000Z" },
    externalProjections: [{
      system: "github", workKey: work.workKey, externalId: "1",
      url: "https://github.com/acme/warehouse/issues/1", state: "verified",
      revisionKey: value.revision.revisionKey, headSha: "head", assignee: "producer-gh",
      verifiedAt: "2026-08-09T10:02:00.000Z",
    }],
  };
}

describe("ChangeMarshal coordination workspace", () => {
  it("renders the public landing page without reading governed cases", () => {
    const value = caseValue();
    const listCases = vi.fn(async () => [value]);
    const client: WorkspaceClient = {
      listCases, getCase: async () => value, sync: async () => value,
      reconcile: async () => value, decide: async () => value,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => { throw new Error("not used"); },
      approveAgent: async () => { throw new Error("not used"); },
    };

    render(<App client={client} sessionClient={localSessionClient} initialPath="/" />);

    expect(screen.getByRole("heading", { name: /turn graph evidence into coordinated, accountable, validated work/i })).not.toBeNull();
    expect(screen.getByText(/DataHub is the canonical institutional memory/i)).not.toBeNull();
    expect(screen.getByText("Graph evidence")).not.toBeNull();
    expect(screen.getByText("Accountable execution")).not.toBeNull();
    expect(screen.getByText("Governed approval")).not.toBeNull();
    expect(screen.getByText("Durable resolution")).not.toBeNull();
    expect(listCases).not.toHaveBeenCalled();
  });

  it("enters the workspace through History API navigation", async () => {
    const value = caseValue();
    const listCases = vi.fn(async () => [value]);
    const read = vi.fn(async () => ({ configured: false, authenticated: true }));
    const client: WorkspaceClient = {
      listCases, getCase: async () => value, sync: async () => value,
      reconcile: async () => value, decide: async () => value,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => { throw new Error("not used"); },
      approveAgent: async () => { throw new Error("not used"); },
    };

    render(<App client={client} sessionClient={{ ...localSessionClient, read }} initialPath="/" />);
    expect(listCases).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("link", { name: /enter governed workspace/i }));

    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await screen.findByRole("heading", { name: /customers governed change/i });
    expect(window.location.pathname).toBe("/workspace");
    expect(listCases).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Control-click", { ctrlKey: true }],
    ["Command-click", { metaKey: true }],
    ["Shift-click", { shiftKey: true }],
    ["Alt-click", { altKey: true }],
    ["middle-click", { button: 1 }],
  ] satisfies readonly (readonly [string, MouseEventInit])[])("preserves native %s workspace link behavior", (_label, click) => {
    const value = caseValue();
    const listCases = vi.fn(async () => [value]);
    const read = vi.fn(async () => ({ configured: false, authenticated: true }));
    const client: WorkspaceClient = {
      listCases, getCase: async () => value, sync: async () => value,
      reconcile: async () => value, decide: async () => value,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => { throw new Error("not used"); },
      approveAgent: async () => { throw new Error("not used"); },
    };
    let preventedByApplication: boolean | undefined;
    const stopJsdomNavigation = (event: Event) => {
      preventedByApplication = event.defaultPrevented;
      event.preventDefault();
    };
    window.addEventListener("click", stopJsdomNavigation);

    try {
      render(<App client={client} sessionClient={{ ...localSessionClient, read }} initialPath="/" />);
      const link = screen.getByRole("link", { name: /enter governed workspace/i });

      fireEvent.click(link, click);

      expect(link.getAttribute("href")).toBe("/workspace");
      expect(preventedByApplication).toBe(false);
      expect(window.location.pathname).toBe("/");
      expect(read).not.toHaveBeenCalled();
      expect(listCases).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("click", stopJsdomNavigation);
    }
  });

  it("responds to browser history navigation", async () => {
    const value = caseValue();
    const listCases = vi.fn(async () => [value]);
    const read = vi.fn(async () => ({ configured: false, authenticated: true }));
    const client: WorkspaceClient = {
      listCases, getCase: async () => value, sync: async () => value,
      reconcile: async () => value, decide: async () => value,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => { throw new Error("not used"); },
      approveAgent: async () => { throw new Error("not used"); },
    };

    render(<App client={client} sessionClient={{ ...localSessionClient, read }} initialPath="/" />);
    window.history.pushState({}, "", "/workspace");
    fireEvent(window, new PopStateEvent("popstate"));

    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await screen.findByRole("heading", { name: /customers governed change/i });
    expect(listCases).toHaveBeenCalledTimes(1);
  });

  it("gates configured unauthenticated workspaces with an accessible password form", async () => {
    const value = caseValue();
    const listCases = vi.fn(async () => [value]);
    const client: WorkspaceClient = {
      listCases, getCase: async () => value, sync: async () => value,
      reconcile: async () => value, decide: async () => value,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => { throw new Error("not used"); },
      approveAgent: async () => { throw new Error("not used"); },
    };
    const sessionClient = { ...localSessionClient, read: async () => ({ configured: true, authenticated: false }) };

    render(<App client={client} sessionClient={sessionClient} initialPath="/workspace" />);

    expect(await screen.findByRole("heading", { name: /operator sign-in/i })).not.toBeNull();
    const passphrase = screen.getByLabelText(/operator passphrase/i);
    expect(passphrase.getAttribute("type")).toBe("password");
    expect(screen.getByRole("button", { name: /sign in to workspace/i })).not.toBeNull();
    expect(listCases).not.toHaveBeenCalled();
  });

  it("fails closed when an unconfigured session is reported unauthenticated", async () => {
    const value = caseValue();
    const listCases = vi.fn(async () => [value]);
    const client: WorkspaceClient = {
      listCases, getCase: async () => value, sync: async () => value,
      reconcile: async () => value, decide: async () => value,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => { throw new Error("not used"); },
      approveAgent: async () => { throw new Error("not used"); },
    };
    const sessionClient = { ...localSessionClient, read: async () => ({ configured: false, authenticated: false }) };

    render(<App client={client} sessionClient={sessionClient} initialPath="/workspace" />);

    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.getByText(/session verification failed/i)).not.toBeNull();
    expect(listCases).not.toHaveBeenCalled();
  });

  it("keeps invalid credentials visibly failed without loading cases", async () => {
    const value = caseValue();
    const listCases = vi.fn(async () => [value]);
    const client: WorkspaceClient = {
      listCases, getCase: async () => value, sync: async () => value,
      reconcile: async () => value, decide: async () => value,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => { throw new Error("not used"); },
      approveAgent: async () => { throw new Error("not used"); },
    };
    const sessionClient = {
      ...localSessionClient,
      read: async () => ({ configured: true, authenticated: false }),
      signIn: async () => { throw new Error("Unauthorized"); },
    };

    render(<App client={client} sessionClient={sessionClient} initialPath="/workspace" />);
    fireEvent.change(await screen.findByLabelText(/operator passphrase/i), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in to workspace/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/sign-in failed.*unauthorized/i);
    expect(listCases).not.toHaveBeenCalled();
  });

  it("reveals real workspace loading only after a verified session succeeds", async () => {
    const value = caseValue();
    const listCases = vi.fn(async () => await new Promise<readonly ChangeCase[]>(() => undefined));
    const client: WorkspaceClient = {
      listCases, getCase: async () => value, sync: async () => value,
      reconcile: async () => value, decide: async () => value,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => { throw new Error("not used"); },
      approveAgent: async () => { throw new Error("not used"); },
    };
    const read = vi.fn()
      .mockResolvedValueOnce({ configured: true, authenticated: false })
      .mockResolvedValueOnce({ configured: true, authenticated: true });
    const signIn = vi.fn(async () => undefined);

    render(<App client={client} sessionClient={{ ...localSessionClient, read, signIn }} initialPath="/workspace" />);
    fireEvent.change(await screen.findByLabelText(/operator passphrase/i), { target: { value: "operator-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in to workspace/i }));

    expect(await screen.findByText("Loading governed cases…")).not.toBeNull();
    expect(signIn).toHaveBeenCalledWith("operator-passphrase");
    expect(read).toHaveBeenCalledTimes(2);
    expect(listCases).toHaveBeenCalledTimes(1);
  });

  it("renders token-free durable agent audit events from a reread DataHub case", async () => {
    const value = caseValue();
    const audited: ChangeCase = {
      ...value,
      agentRuns: [{
        runId: "run-durable-1", caseKey: value.caseKey, revisionKey: value.revision.revisionKey,
        headSha: value.revision.headSha, modelId: "qwen3.6-27b", status: "completed",
        events: [
          { kind: "run_started", sequence: 1, at: "2026-08-09T15:00:00.000Z", summary: "Governed run started" },
          { kind: "tool_approved", sequence: 2, at: "2026-08-09T15:01:00.000Z", summary: "Approved exact arguments", toolName: "generateRemediation", toolCallId: "call-1", approvalId: "approval-1", argumentsHash: "a".repeat(64), approved: true },
          { kind: "run_completed", sequence: 3, at: "2026-08-09T15:02:00.000Z", summary: "Governed run completed" },
        ],
        answer: "Verified remediation outcome",
        createdAt: "2026-08-09T15:00:00.000Z", updatedAt: "2026-08-09T15:02:00.000Z",
      }],
    };
    const client: WorkspaceClient = {
      listCases: async () => [audited], getCase: async () => audited, sync: async () => audited,
      reconcile: async () => audited, decide: async () => audited,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => { throw new Error("not used"); },
      approveAgent: async () => { throw new Error("not used"); },
    };

    render(<App client={client} sessionClient={localSessionClient} initialPath="/workspace" />);

    const audit = await screen.findByRole("list", { name: /durable agent audit/i });
    expect(audit.textContent).toContain("qwen3.6-27b");
    expect(audit.textContent).toContain("tool approved");
    expect(audit.textContent).toContain("Approved exact arguments");
    expect(screen.queryByRole("button", { name: /Approve generateRemediation/i })).toBeNull();
  });

  it("renders governed evidence, work, approvals, blockers, and real projections", async () => {
    const value = caseValue();
    const client: WorkspaceClient = {
      listCases: async () => [value],
      getCase: async () => value,
      sync: async () => value,
      reconcile: async () => value,
      decide: async () => value,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => { throw new Error("not used"); },
      approveAgent: async () => { throw new Error("not used"); },
    };
    render(<App client={client} sessionClient={localSessionClient} initialPath="/workspace" />);

    expect(screen.getByText("Verifying operator session…")).not.toBeNull();
    await waitFor(() => expect(screen.getByRole("heading", { name: /customers/i })).not.toBeNull());
    expect(screen.getByRole("region", { name: /governed execution graph/i })).not.toBeNull();
    expect(screen.getByText("Git change")).not.toBeNull();
    expect(screen.getAllByText("Merge decision").length).toBeGreaterThan(0);
    expect(screen.getByText(/Deterministic policy alone controls admission/i)).not.toBeNull();
    expect(screen.getByText("ChangeMarshal")).not.toBeNull();
    expect(screen.queryByText("Cutset")).toBeNull();
    expect(screen.getByLabelText("email → email_address")).not.toBeNull();
    expect(screen.getByText(/OWNER_MAPPING_MISSING/)).not.toBeNull();
    expect(screen.getAllByText("orders").length).toBeGreaterThan(0);
    expect(screen.getByText(/Implement compatible producer migration/)).not.toBeNull();
    expect(screen.getAllByText("Awaiting").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Submit the requested review in GitHub/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Approve as/i })).toBeNull();
    expect(screen.getByRole("link", { name: /Open GitHub issue/i }).getAttribute("href"))
      .toBe("https://github.com/acme/warehouse/issues/1");
  });

  it("runs a QVAC coordinator and requires an explicit browser approval for mutations", async () => {
    const value = caseValue();
    const pending: AgentRunSnapshot = {
      runId: "run-real-1", caseKey: value.caseKey, headSha: value.revision.headSha.padEnd(40, "a").slice(0, 40),
      modelId: "qwen3.6-27b", status: "waiting_for_approval",
      events: [{ kind: "approval_required", sequence: 1, at: "2026-08-09T15:00:00.000Z", summary: "Approval required for generateRemediation", toolName: "generateRemediation", toolCallId: "call-1", approvalId: "approval-1", argumentsHash: "a".repeat(64) }],
      pendingApproval: { token: "token-real-1", approvalId: "approval-1", toolCallId: "call-1", toolName: "generateRemediation", argumentsHash: "a".repeat(64), requestedAt: "2026-08-09T15:00:00.000Z", expiresAt: "2026-08-09T15:15:00.000Z" },
    };
    const approveAgent = vi.fn(async () => ({ ...pending, status: "completed" as const, pendingApproval: undefined }));
    const startAgent = vi.fn(async () => pending);
    const client: WorkspaceClient = {
      listCases: async () => [value], getCase: async () => value, sync: async () => value,
      reconcile: async () => value, decide: async () => value,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent,
      approveAgent,
    };
    render(<App client={client} sessionClient={localSessionClient} initialPath="/workspace" />);

    const run = await screen.findByRole("button", { name: /Run QVAC coordinator/i });
    fireEvent.click(run);
    const approve = await screen.findByRole("button", { name: /Approve generateRemediation/i });
    expect(startAgent).toHaveBeenCalledWith(
      value.caseKey,
      expect.stringMatching(/compatibility remediation/i),
    );
    expect(screen.getByText(/exact arguments hash/i)).not.toBeNull();
    fireEvent.click(approve);
    await waitFor(() => expect(approveAgent).toHaveBeenCalledWith(
      "run-real-1", "token-real-1", true, "Approved in ChangeMarshal command center",
    ));
  });
});
