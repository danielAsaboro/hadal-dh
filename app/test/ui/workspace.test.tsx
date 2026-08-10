// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentRunSnapshot } from "../../src/ai/run-events";
import type { ChangeCase, ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import { App, type WorkspaceClient } from "../../src/ui/App";
import { StatePill } from "../../src/ui/CaseSections";
import { StatusIndicator, type OperationalStatus } from "../../src/ui/StatusIndicator";

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

function caseValue(options: Readonly<{
  repository?: string;
  modelName?: string;
  consumerName?: string;
  headSha?: string;
}> = {}): ChangeCase {
  const repository = options.repository ?? "acme/warehouse";
  const modelName = options.modelName ?? "customers";
  const consumerName = options.consumerName ?? "orders";
  const headSha = options.headSha ?? "head";
  const source = `urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.${modelName},PROD)`;
  const consumer = `urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.${consumerName},PROD)`;
  const evidence: ImpactEvidence = {
    complete: true,
    source: { urn: source, type: "dataset", name: modelName }, schemaFields: ["email"],
    paths: [{ sourceUrn: source, downstreamUrn: consumer, column: "email", downstreamColumns: ["email"], nodes: [source, consumer] }],
    assets: [
      { urn: source, type: "dataset", name: modelName, owners: ["urn:li:corpuser:producer"], tags: ["urn:li:tag:PII"], glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete: true },
      { urn: consumer, type: "dataset", name: consumerName, owners: ["urn:li:corpuser:consumer"], tags: [], glossaryTerms: [], incidentStatuses: ["WARN"], assertions: [], queries: [], complete: true },
    ],
  };
  const value = compileCase(evidence, {
    repository, baseSha: "base", headSha, observedAt: "2026-08-09T10:00:00.000Z",
    change: { kind: "dbt_column_rename", modelName, oldName: "email", newName: "email_address", sourcePath: `models/${modelName}.yml` },
  });
  const work = value.workItems[0]!;
  return {
    ...value,
    admission: { allowed: false, blockers: ["OWNER_MAPPING_MISSING:urn:li:corpuser:producer"], revisionKey: value.revision.revisionKey, headSha, evaluatedAt: "2026-08-09T10:01:00.000Z" },
    externalProjections: [{
      system: "github", workKey: work.workKey, externalId: "1",
      url: `https://github.com/${repository}/issues/1`, state: "verified",
      revisionKey: value.revision.revisionKey, headSha, assignee: "producer-gh",
      verifiedAt: "2026-08-09T10:02:00.000Z",
    }],
  };
}

function clientFor(value: ChangeCase, overrides: Partial<WorkspaceClient> = {}): WorkspaceClient {
  return {
    listCases: async () => [value],
    getCase: async () => value,
    sync: async () => value,
    reconcile: async () => value,
    decide: async () => value,
    agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
    startAgent: async () => { throw new Error("not used"); },
    approveAgent: async () => { throw new Error("not used"); },
    ...overrides,
  };
}

function casePath(value: ChangeCase, page = "overview"): string {
  return `/workspace/cases/${value.caseKey}/${page}`;
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

  it("names the public landmark and keeps its primary navigation keyboard reachable", () => {
    render(<App client={clientFor(caseValue())} sessionClient={localSessionClient} initialPath="/" />);

    expect(screen.getByRole("main", { name: /turn graph evidence into coordinated, accountable, validated work/i })).not.toBeNull();
    const navigation = screen.getByRole("navigation", { name: /landing navigation/i });
    expect(within(navigation).getByRole("link", { name: /how it works/i }).getAttribute("href")).toBe("#method");
    expect(within(navigation).getByRole("link", { name: /why it matters/i }).getAttribute("href")).toBe("#principles");
    expect(screen.getByRole("link", { name: /enter governed workspace/i }).tabIndex).toBe(0);
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
    await screen.findByRole("heading", { name: /operational overview/i });
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
    await screen.findByRole("heading", { name: /operational overview/i });
    expect(listCases).toHaveBeenCalledTimes(1);
  });

  it("keeps one application shell and one canonical case load across global route changes", async () => {
    const value = caseValue();
    const listCases = vi.fn(async () => [value]);
    render(<App client={clientFor(value, { listCases })} sessionClient={localSessionClient} initialPath="/workspace" />);

    await screen.findByRole("heading", { name: /operational overview/i });
    const rail = screen.getByRole("complementary", { name: /workspace application rail/i });
    const navigation = within(rail).getByRole("navigation", { name: /workspace navigation/i });
    expect(within(navigation).getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/workspace");
    expect(within(navigation).getByRole("link", { name: "Cases" }).getAttribute("href")).toBe("/workspace/cases");
    expect(within(navigation).getByRole("link", { name: "Work" }).getAttribute("href")).toBe("/workspace/work");
    expect(within(navigation).getByRole("link", { name: "Approvals" }).getAttribute("href")).toBe("/workspace/approvals");
    expect(screen.getByText("Menu").closest("details")?.className).toContain("mobile-workspace-menu");

    fireEvent.click(within(navigation).getByRole("link", { name: "Cases" }));
    await screen.findByRole("heading", { name: /governed cases/i });
    expect(window.location.pathname).toBe("/workspace/cases");
    expect(screen.getByRole("complementary", { name: /workspace application rail/i })).toBe(rail);

    fireEvent.click(within(navigation).getByRole("link", { name: "Work" }));
    await screen.findByRole("heading", { name: /owner work/i });
    fireEvent.click(within(navigation).getByRole("link", { name: "Approvals" }));
    await screen.findByRole("heading", { name: /governed approvals/i });

    expect(listCases).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status", { name: /canonical DataHub context/i }).textContent).toMatch(/DataHub canonical/i);
  });

  it("bounds the global case table to twenty-five real rows per page", async () => {
    const values = Array.from({ length: 26 }, (_, index) => caseValue({
      repository: `acme/repository-${String(index).padStart(2, "0")}`,
      modelName: `model-${String(index).padStart(2, "0")}`,
      consumerName: `consumer-${String(index).padStart(2, "0")}`,
      headSha: `head-${index}`,
    }));
    render(<App
      client={clientFor(values[0]!, { listCases: async () => values })}
      sessionClient={localSessionClient}
      initialPath="/workspace/cases"
    />);

    const table = await screen.findByRole("table", { name: /governed cases/i });
    expect(within(table).getAllByRole("row")).toHaveLength(26);
    expect(within(table).getByText("model-00")).not.toBeNull();
    expect(within(table).queryByText("model-25")).toBeNull();
    expect(screen.getByRole("status", { name: /case pagination/i }).textContent).toMatch(/Page 1 of 2.*26 rows/i);

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("model-25")).not.toBeNull();
  });

  it("shows only real GitHub decisions and links pending QVAC gates to the case run page", async () => {
    const value = caseValue();
    const requirement = value.approvalRequirements[0]!;
    const governed: ChangeCase = {
      ...value,
      approvalDecisions: [{
        requirementKey: requirement.requirementKey,
        revisionKey: requirement.revisionKey,
        headSha: value.revision.headSha,
        role: requirement.role,
        ownerUrn: requirement.ownerUrn,
        actorLogin: "producer-reviewer",
        verdict: "approve",
        decidedAt: "2026-08-09T15:05:00.000Z",
        source: "github",
        externalId: "review-17",
        url: "https://github.com/acme/warehouse/pull/17#pullrequestreview-17",
      }],
      agentRuns: [{
        runId: "run-global-gate",
        caseKey: value.caseKey,
        revisionKey: value.revision.revisionKey,
        headSha: value.revision.headSha,
        modelId: "qwen3.6-27b",
        status: "waiting_for_approval",
        events: [{
          kind: "approval_required", sequence: 1, at: "2026-08-09T15:10:00.000Z",
          summary: "Approval required for generateRemediation", toolName: "generateRemediation",
          toolCallId: "call-global", approvalId: "approval-global", argumentsHash: "d".repeat(64),
        }],
        pendingApproval: {
          approvalId: "approval-global", toolCallId: "call-global", toolName: "generateRemediation",
          argumentsHash: "d".repeat(64), requestedAt: "2026-08-09T15:10:00.000Z", expiresAt: "2026-08-09T15:25:00.000Z",
        },
        createdAt: "2026-08-09T15:10:00.000Z",
        updatedAt: "2026-08-09T15:10:00.000Z",
      }],
    };
    render(<App client={clientFor(governed)} sessionClient={localSessionClient} initialPath="/workspace/approvals" />);

    const table = await screen.findByRole("table", { name: /governed approvals/i });
    expect(within(table).getByText("producer-reviewer")).not.toBeNull();
    expect(within(table).getByRole("link", { name: /open GitHub decision/i }).getAttribute("href"))
      .toBe("https://github.com/acme/warehouse/pull/17#pullrequestreview-17");
    expect(within(table).getByText("generateRemediation")).not.toBeNull();
    expect(within(table).getByRole("link", { name: /open QVAC gate/i }).getAttribute("href"))
      .toBe(`/workspace/cases/${value.caseKey}/run`);
    expect(within(table).queryByRole("button", { name: /approve|deny/i })).toBeNull();
  });

  it("keeps a direct nested case page behind the configured session gate", async () => {
    const value = caseValue();
    const listCases = vi.fn(async () => [value]);
    const client = clientFor(value, { listCases });
    const sessionClient = { ...localSessionClient, read: async () => ({ configured: true, authenticated: false }) };

    render(<App client={client} sessionClient={sessionClient} initialPath={`/workspace/cases/${value.caseKey}/graph`} />);

    expect(await screen.findByRole("heading", { name: /operator sign-in/i })).not.toBeNull();
    expect(listCases).not.toHaveBeenCalled();
  });

  it("replaces a bare case URL with its overview URL", async () => {
    const value = caseValue();
    window.history.replaceState({}, "", `/workspace/cases/${value.caseKey}`);

    render(<App client={clientFor(value)} sessionClient={localSessionClient} initialPath={`/workspace/cases/${value.caseKey}`} />);

    await screen.findByRole("heading", { name: /customers governed change/i });
    expect(window.location.pathname).toBe(`/workspace/cases/${value.caseKey}/overview`);
  });

  it("preserves query and anchor state while replacing a bare case URL", async () => {
    const value = caseValue();
    window.history.replaceState({}, "", `/workspace/cases/${value.caseKey}?source=notification#work`);

    render(<App client={clientFor(value)} sessionClient={localSessionClient} initialPath={`/workspace/cases/${value.caseKey}`} />);

    await screen.findByRole("heading", { name: /customers governed change/i });
    expect(window.location.href).toContain(`/workspace/cases/${value.caseKey}/overview?source=notification#work`);
  });

  it("renders an explicit public not-found state instead of the landing page", () => {
    render(<App client={clientFor(caseValue())} sessionClient={localSessionClient} initialPath="/pricing" />);

    expect(screen.getByRole("heading", { name: /public page not found/i })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /turn graph evidence/i })).toBeNull();
  });

  it("renders an explicit missing-case state without loading a different case", async () => {
    const current = caseValue({ modelName: "customers" });
    const missingCaseKey = "0123456789abcdef01234567";
    const listCases = vi.fn(async () => [current]);
    render(<App
      client={clientFor(current, { listCases })}
      sessionClient={localSessionClient}
      initialPath={`/workspace/cases/${missingCaseKey}/overview`}
    />);

    expect(await screen.findByRole("heading", { name: /case not found/i })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /customers governed change/i })).toBeNull();
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

  it("names the sign-in landmark from its visible operator heading", async () => {
    const value = caseValue();
    const sessionClient = { ...localSessionClient, read: async () => ({ configured: true, authenticated: false }) };

    render(<App client={clientFor(value)} sessionClient={sessionClient} initialPath="/workspace" />);

    expect(await screen.findByRole("main", { name: /operator sign-in/i })).not.toBeNull();
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

    const loading = await screen.findByRole("status", { name: /governed case loading status/i });
    expect(loading.textContent).toContain("Loading governed cases…");
    expect(signIn).toHaveBeenCalledWith("operator-passphrase");
    expect(read).toHaveBeenCalledTimes(2);
    expect(listCases).toHaveBeenCalledTimes(1);
  });

  it("signs a configured operator out only after the session client succeeds", async () => {
    const value = caseValue();
    let finishSignOut: (() => void) | undefined;
    const signOutResult = new Promise<void>((resolve) => { finishSignOut = resolve; });
    const signOut = vi.fn(async () => await signOutResult);
    const sessionClient = {
      ...localSessionClient,
      read: async () => ({ configured: true, authenticated: true }),
      signOut,
    };

    render(<App client={clientFor(value)} sessionClient={sessionClient} initialPath="/workspace" />);

    const signOutButton = await screen.findByRole("button", { name: /sign out/i });
    expect(signOutButton.tabIndex).toBe(0);
    expect(screen.queryByRole("heading", { name: /operator sign-in/i })).toBeNull();
    fireEvent.click(signOutButton);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect((signOutButton as HTMLButtonElement).disabled).toBe(true);
    expect(signOutButton.textContent).toMatch(/signing out/i);
    expect(screen.getByRole("heading", { name: /operational overview/i })).not.toBeNull();

    finishSignOut?.();
    expect(await screen.findByRole("heading", { name: /operator sign-in/i })).not.toBeNull();
  });

  it("keeps a configured workspace open and reports a failed sign-out honestly", async () => {
    const value = caseValue();
    const signOut = vi.fn(async () => { throw new Error("Session store unavailable"); });
    const sessionClient = {
      ...localSessionClient,
      read: async () => ({ configured: true, authenticated: true }),
      signOut,
    };

    render(<App client={clientFor(value)} sessionClient={sessionClient} initialPath="/workspace" />);
    fireEvent.click(await screen.findByRole("button", { name: /sign out/i }));

    const failure = await screen.findByRole("alert");
    expect(failure.textContent).toMatch(/sign-out failed.*session store unavailable/i);
    expect(screen.getByRole("heading", { name: /operational overview/i })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /operator sign-in/i })).toBeNull();
    expect((screen.getByRole("button", { name: /sign out/i }) as HTMLButtonElement).disabled).toBe(false);
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

    render(<App client={client} sessionClient={localSessionClient} initialPath={casePath(audited)} />);

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
    render(<App client={client} sessionClient={localSessionClient} initialPath={casePath(value)} />);

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
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
  });

  it.each([
    ["Enter", "Enter"],
    ["Space", " "],
  ] as const)("keeps the evidence inspector synchronized with %s node selection", async (_label, key) => {
    const value = caseValue();
    render(<App client={clientFor(value)} sessionClient={localSessionClient} initialPath={casePath(value)} />);

    const inspector = await screen.findByRole("complementary", { name: /selected execution evidence/i });
    expect(within(inspector).getByRole("heading", { name: /merge decision/i })).not.toBeNull();
    const dataHubNode = screen.getByText("DataHub impact").closest<HTMLElement>(".react-flow__node");
    if (dataHubNode === null) throw new Error("DataHub React Flow node wrapper was not rendered");
    expect(dataHubNode.tabIndex).toBe(0);
    dataHubNode.focus();
    fireEvent.keyDown(dataHubNode, { key, code: key === " " ? "Space" : key });

    await waitFor(() => expect(within(inspector).getByRole("heading", { name: /DataHub impact/i })).not.toBeNull());
    expect(within(inspector).getByText(/Exact graph evidence/i)).not.toBeNull();

    const gitNode = screen.getByText("Git change").closest<HTMLElement>(".react-flow__node");
    expect(gitNode).not.toBeNull();
    fireEvent.click(gitNode!);
    await waitFor(() => expect(within(inspector).getByRole("heading", { name: /Git change/i })).not.toBeNull());
  });

  it("names workspace landmarks and exposes canonical and action state as live text", async () => {
    const value = caseValue();
    let finishSync: ((next: ChangeCase) => void) | undefined;
    const syncResult = new Promise<ChangeCase>((resolve) => { finishSync = resolve; });
    render(<App
      client={clientFor(value, { sync: async () => await syncResult })}
      sessionClient={localSessionClient}
      initialPath={casePath(value)}
    />);

    const workspace = await screen.findByRole("main", { name: /customers governed change/i });
    expect(screen.getByRole("navigation", { name: /workspace navigation/i })).not.toBeNull();
    const sections = within(workspace).getByRole("navigation", { name: /case sections/i });
    expect(within(sections).getByRole("link", { name: /graph/i }).getAttribute("href")).toBe("#execution-graph");

    const canonical = screen.getByRole("status", { name: /canonical DataHub context/i });
    expect(canonical.getAttribute("aria-live")).toBe("polite");
    expect(canonical.textContent).toMatch(/✓.*DataHub canonical/i);

    const actions = within(workspace).getByRole("region", { name: /case actions/i });
    const sync = within(actions).getByRole("button", { name: /sync owner work/i });
    expect(sync.tabIndex).toBe(0);
    const actionStatus = screen.getByRole("status", { name: /case action status/i });
    expect(actions.contains(actionStatus)).toBe(false);
    expect(workspace.contains(actionStatus)).toBe(true);
    expect(actionStatus.getAttribute("aria-live")).toBe("polite");
    expect(actionStatus.textContent).toMatch(/case actions ready/i);

    fireEvent.click(sync);
    expect(actions.getAttribute("aria-busy")).toBe("true");
    expect(actionStatus.textContent).toMatch(/syncing owner work/i);
    finishSync?.(value);
    await waitFor(() => expect(actions.getAttribute("aria-busy")).toBe("false"));
  });

  it("filters the real case picker by repository, model name, and exact case key before opening overview", async () => {
    const customers = caseValue();
    const campaigns = caseValue({
      repository: "acme/marketing",
      modelName: "campaigns",
      consumerName: "attribution",
      headSha: "campaign-head",
    });
    const client = clientFor(customers, {
      listCases: async () => [customers, campaigns],
      getCase: async (caseKey) => caseKey === customers.caseKey ? customers : campaigns,
    });
    render(<App client={client} sessionClient={localSessionClient} initialPath={casePath(customers)} />);

    const picker = await screen.findByRole("searchbox", { name: /find a governed case/i });
    fireEvent.change(picker, { target: { value: campaigns.caseKey } });
    expect(screen.getByRole("link", { name: /campaigns.*acme\/marketing/i })).not.toBeNull();
    expect(screen.queryByRole("link", { name: /customers.*acme\/warehouse/i })).toBeNull();
    fireEvent.change(picker, { target: { value: "campaigns" } });
    expect(screen.getByRole("link", { name: /campaigns.*acme\/marketing/i })).not.toBeNull();
    fireEvent.change(picker, { target: { value: "acme/marketing" } });
    const campaignLink = screen.getByRole("link", { name: /campaigns.*acme\/marketing/i });
    expect(screen.queryByRole("link", { name: /customers.*acme\/warehouse/i })).toBeNull();

    fireEvent.click(campaignLink);
    await screen.findByRole("heading", { name: /campaigns governed change/i });
    expect(window.location.pathname).toBe(`/workspace/cases/${campaigns.caseKey}/overview`);
    expect(campaignLink.getAttribute("href")).toBe(`/workspace/cases/${campaigns.caseKey}/overview`);
  });

  it.each([
    ["verified", "Verified", "✓"],
    ["waiting", "Waiting", "◷"],
    ["blocked", "Blocked", "■"],
    ["active", "Active", "◆"],
    ["failed", "Failed", "×"],
    ["unavailable", "Unavailable", "—"],
  ] satisfies readonly (readonly [OperationalStatus, string, string])[])(
    "renders %s with literal text and a non-color icon",
    (status, label, icon) => {
      render(<StatusIndicator status={status} />);

      const indicator = screen.getByRole("img", { name: `${label} status` });
      expect(indicator.textContent).toContain(label);
      expect(indicator.textContent).toContain(icon);
    },
  );

  it.each([
    ["blocked_context", "Blocked context", "Blocked", "■"],
    ["blocked_ownership", "Blocked ownership", "Blocked", "■"],
    ["in_progress", "In progress", "Active", "◆"],
    ["stale", "Stale", "Failed", "×"],
    ["approved", "Approved", "Verified", "✓"],
    ["resolved", "Resolved", "Verified", "✓"],
  ] as const)("maps %s to the %s operational family with icon and text", (state, label, family, icon) => {
    render(<StatePill value={state} />);

    const pill = screen.getByRole("img", { name: `${label}: ${family} status` });
    expect(pill.textContent).toContain(label.toLowerCase());
    expect(pill.textContent).toContain(icon);
  });

  it("renders unavailable as a QVAC integration indicator without changing canonical flow stages", async () => {
    const value = caseValue();
    render(<App
      client={clientFor(value, { agentHealth: async () => { throw new Error("QVAC endpoint offline"); } })}
      sessionClient={localSessionClient}
      initialPath={casePath(value)}
    />);

    await screen.findByRole("status", { name: /QVAC integration status/i });
    expect(screen.getByRole("img", { name: "Unavailable status" })).not.toBeNull();
    expect(screen.queryByLabelText(/DataHub impact:.*Unavailable/i)).toBeNull();
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
    render(<App client={client} sessionClient={localSessionClient} initialPath={casePath(value)} />);

    const run = await screen.findByRole("button", { name: /Run QVAC coordinator/i });
    fireEvent.click(run);
    const approve = await screen.findByRole("button", { name: /Approve generateRemediation/i });
    const gate = screen.getByRole("group", { name: /Approval required for generateRemediation/i });
    expect(startAgent).toHaveBeenCalledWith(
      value.caseKey,
      expect.stringMatching(/compatibility remediation/i),
    );
    expect(gate.textContent).toContain("generateRemediation");
    expect(gate.textContent).toContain(value.caseKey);
    expect(gate.textContent).toContain(value.repository);
    expect(gate.textContent).toContain(pending.headSha);
    expect(gate.textContent).toContain(pending.pendingApproval!.argumentsHash);
    expect(gate.textContent).toContain(pending.pendingApproval!.expiresAt);
    expect(gate.textContent).toMatch(/authorizes only this exact hashed tool call/i);
    expect(gate.textContent).toMatch(/may mutate configured systems/i);
    expect(within(gate).getByText(/no outcome or artifact path is guaranteed/i)).not.toBeNull();
    fireEvent.click(approve);
    await waitFor(() => expect(approveAgent).toHaveBeenCalledWith(
      "run-real-1", "token-real-1", true, "Approved in ChangeMarshal command center",
    ));
  });

  it("preserves exact denial callback arguments at the human mutation gate", async () => {
    const value = caseValue();
    const pending: AgentRunSnapshot = {
      runId: "run-real-deny", caseKey: value.caseKey, headSha: value.revision.headSha.padEnd(40, "b").slice(0, 40),
      modelId: "qwen3.6-27b", status: "waiting_for_approval",
      events: [{ kind: "approval_required", sequence: 1, at: "2026-08-09T15:00:00.000Z", summary: "Approval required for generateRemediation", toolName: "generateRemediation", toolCallId: "call-deny", approvalId: "approval-deny", argumentsHash: "b".repeat(64) }],
      pendingApproval: { token: "token-real-deny", approvalId: "approval-deny", toolCallId: "call-deny", toolName: "generateRemediation", argumentsHash: "b".repeat(64), requestedAt: "2026-08-09T15:00:00.000Z", expiresAt: "2026-08-09T15:15:00.000Z" },
    };
    const approveAgent = vi.fn(async () => ({ ...pending, status: "completed" as const, pendingApproval: undefined }));
    const client: WorkspaceClient = {
      listCases: async () => [value], getCase: async () => value, sync: async () => value,
      reconcile: async () => value, decide: async () => value,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => pending,
      approveAgent,
    };
    render(<App client={client} sessionClient={localSessionClient} initialPath={casePath(value)} />);

    fireEvent.click(await screen.findByRole("button", { name: /Run QVAC coordinator/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Deny generateRemediation/i }));

    await waitFor(() => expect(approveAgent).toHaveBeenCalledWith(
      "run-real-deny", "token-real-deny", false, "Denied in ChangeMarshal command center",
    ));
  });

  it("keeps approval scope and reread bound to run case A after selecting case B", async () => {
    const caseA = caseValue();
    const caseB = caseValue({
      repository: "acme/marketing",
      modelName: "campaigns",
      consumerName: "attribution",
      headSha: "campaign-head",
    });
    const pending: AgentRunSnapshot = {
      runId: "run-case-a", caseKey: caseA.caseKey, headSha: caseA.revision.headSha.padEnd(40, "c").slice(0, 40),
      modelId: "qwen3.6-27b", status: "waiting_for_approval",
      events: [{ kind: "approval_required", sequence: 1, at: "2026-08-09T15:00:00.000Z", summary: "Approval required for generateRemediation", toolName: "generateRemediation", toolCallId: "call-case-a", approvalId: "approval-case-a", argumentsHash: "c".repeat(64) }],
      pendingApproval: { token: "token-case-a", approvalId: "approval-case-a", toolCallId: "call-case-a", toolName: "generateRemediation", argumentsHash: "c".repeat(64), requestedAt: "2026-08-09T15:00:00.000Z", expiresAt: "2026-08-09T15:15:00.000Z" },
    };
    const getCase = vi.fn(async (caseKey: string) => caseKey === caseA.caseKey ? caseA : caseB);
    const client: WorkspaceClient = {
      listCases: async () => [caseA, caseB], getCase, sync: async () => caseA,
      reconcile: async () => caseA, decide: async () => caseA,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => pending,
      approveAgent: async () => ({ ...pending, status: "completed", pendingApproval: undefined }),
    };
    render(<App client={client} sessionClient={localSessionClient} initialPath={casePath(caseA)} />);

    fireEvent.click(await screen.findByRole("button", { name: /Run QVAC coordinator/i }));
    await screen.findByRole("group", { name: /Approval required for generateRemediation/i });
    fireEvent.change(screen.getByRole("searchbox", { name: /find a governed case/i }), { target: { value: "campaigns" } });
    fireEvent.click(screen.getByRole("link", { name: /campaigns.*acme\/marketing/i }));
    await screen.findByRole("heading", { name: /campaigns governed change/i });

    const gate = screen.getByRole("group", { name: /Approval required for generateRemediation/i });
    expect(gate.textContent).toContain(caseA.caseKey);
    expect(gate.textContent).toContain(caseA.repository);
    expect(gate.textContent).toContain(pending.headSha);
    expect(gate.textContent).not.toContain(caseB.repository);

    fireEvent.click(within(gate).getByRole("button", { name: /Approve generateRemediation/i }));
    await waitFor(() => expect(getCase).toHaveBeenLastCalledWith(caseA.caseKey));
    expect(screen.getByRole("heading", { name: /campaigns governed change/i })).not.toBeNull();
  });

  it("explains an unavailable QVAC integration and retries its real health check", async () => {
    const value = caseValue();
    let finishHealthRetry: ((health: Awaited<ReturnType<WorkspaceClient["agentHealth"]>>) => void) | undefined;
    const healthRetry = new Promise<Awaited<ReturnType<WorkspaceClient["agentHealth"]>>>((resolve) => {
      finishHealthRetry = resolve;
    });
    const agentHealth = vi.fn()
      .mockRejectedValueOnce(new Error("QVAC endpoint offline"))
      .mockReturnValueOnce(healthRetry);
    const client: WorkspaceClient = {
      listCases: async () => [value], getCase: async () => value, sync: async () => value,
      reconcile: async () => value, decide: async () => value, agentHealth,
      startAgent: async () => { throw new Error("not used"); },
      approveAgent: async () => { throw new Error("not used"); },
    };
    render(<App client={client} sessionClient={localSessionClient} initialPath={casePath(value)} />);

    const status = await screen.findByRole("status", { name: /QVAC integration status/i });
    expect(status.textContent).toMatch(/unavailable.*QVAC endpoint offline/i);
    expect(status.textContent).toMatch(/coordination remains disabled until a verified health check succeeds/i);
    expect(screen.getByRole("button", { name: /Retry QVAC health check/i })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Retry QVAC health check/i }));
    await waitFor(() => expect(screen.getByRole("status", { name: /QVAC integration status/i }).textContent)
      .toMatch(/retry in progress.*QVAC endpoint offline/i));
    finishHealthRetry?.({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true });
    expect(await screen.findByRole("heading", { name: /qwen3.6-27b coordinator/i })).not.toBeNull();
    expect(agentHealth).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed DataHub case load visible and retries without hiding the failure", async () => {
    const value = caseValue();
    let finishRetry: ((values: readonly ChangeCase[]) => void) | undefined;
    const retryResult = new Promise<readonly ChangeCase[]>((resolve) => { finishRetry = resolve; });
    const listCases = vi.fn()
      .mockRejectedValueOnce(new Error("DataHub graph request timed out"))
      .mockReturnValueOnce(retryResult);
    const client: WorkspaceClient = {
      listCases, getCase: async () => value, sync: async () => value,
      reconcile: async () => value, decide: async () => value,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => { throw new Error("not used"); },
      approveAgent: async () => { throw new Error("not used"); },
    };
    render(<App client={client} sessionClient={localSessionClient} initialPath="/workspace" />);

    const failure = await screen.findByRole("alert");
    expect(failure.textContent).toMatch(/DataHub case load failed.*DataHub graph request timed out/i);
    fireEvent.click(screen.getByRole("button", { name: /Retry governed case load/i }));

    expect(await screen.findByRole("status", { name: /governed case loading status/i })).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/DataHub graph request timed out/i);
    finishRetry?.([value]);
    expect(await screen.findByRole("heading", { name: /operational overview/i })).not.toBeNull();
    expect(listCases).toHaveBeenCalledTimes(2);
  });

  it("names the canonical prerequisite when DataHub has no governed cases", async () => {
    const client: WorkspaceClient = {
      listCases: async () => [], getCase: async () => { throw new Error("not used"); },
      sync: async () => { throw new Error("not used"); }, reconcile: async () => { throw new Error("not used"); },
      decide: async () => { throw new Error("not used"); },
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => { throw new Error("not used"); }, approveAgent: async () => { throw new Error("not used"); },
    };
    render(<App client={client} sessionClient={localSessionClient} initialPath="/workspace" />);

    const main = await screen.findByRole("main", { name: /operational overview/i });
    const empty = within(main).getByRole("status", { name: /governed case empty state/i });
    expect(empty.textContent).toMatch(/No governed ChangeMarshal cases exist in DataHub/i);
    expect(empty.textContent).toMatch(/A canonical DataHub change case is required before work can begin/i);
    expect(screen.getByRole("navigation", { name: /workspace navigation/i })).not.toBeNull();
  });
});
