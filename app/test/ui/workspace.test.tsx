// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentRunSnapshot } from "../../src/ai/run-events";
import type { ChangeCase, ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import { App, type WorkspaceClient } from "../../src/ui/App";
import { StatePill } from "../../src/ui/CaseSections";
import { StatusIndicator, type OperationalStatus } from "../../src/ui/StatusIndicator";
import { Workspace } from "../../src/ui/Workspace";

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

  it("renders the exact routed case synchronously without exposing retained case data", async () => {
    const first = caseValue({ modelName: "customers", repository: "acme/warehouse" });
    const second = caseValue({ modelName: "campaigns", repository: "acme/marketing", consumerName: "attribution" });
    const missingCaseKey = "0123456789abcdef01234567";
    const client = clientFor(first, { listCases: async () => [first, second] });
    const commits: string[] = [];
    const renderRoute = (caseKey: string) => (
      <Profiler id="routed-workspace" onRender={() => commits.push(document.body.textContent ?? "")}>
        <Workspace
          client={client}
          route={{ kind: "case", caseKey, page: "overview" }}
          onNavigate={() => undefined}
        />
      </Profiler>
    );

    const rendered = render(renderRoute(first.caseKey));
    await screen.findByRole("heading", { name: /customers governed change/i });

    commits.length = 0;
    rendered.rerender(renderRoute(second.caseKey));
    expect(commits.some((content) => content.includes("customers governed change"))).toBe(false);
    expect(screen.getByRole("heading", { name: /campaigns governed change/i })).not.toBeNull();

    commits.length = 0;
    rendered.rerender(renderRoute(missingCaseKey));
    expect(commits.some((content) => content.includes("campaigns governed change"))).toBe(false);
    expect(screen.getByRole("heading", { name: /case not found/i })).not.toBeNull();
  });

  it("keeps a compact governed identity while each case route mounts only its owned content", async () => {
    const base = caseValue();
    const value: ChangeCase = {
      ...base,
      dataHub: {
        verified: true,
        documentUrn: `urn:li:dataset:(urn:li:dataPlatform:datahub,change_marshal.${base.caseKey},PROD)`,
        verifiedAt: "2026-08-09T15:20:00.000Z",
      },
    };
    const listCases = vi.fn(async () => [value]);
    render(<App client={clientFor(value, { listCases })} sessionClient={localSessionClient} initialPath={casePath(value)} />);

    const identity = await screen.findByRole("region", { name: /customers governed change/i });
    expect(identity.textContent).toContain("acme/warehouse");
    expect(identity.textContent).toContain("email");
    expect(identity.textContent).toContain("email_address");
    expect(identity.textContent).toContain(value.revision.headSha);
    expect(identity.textContent).toMatch(/DataHub.*reread verified/i);
    expect(within(identity).getByRole("searchbox", { name: /find a governed case/i })).not.toBeNull();
    const breadcrumb = within(identity).getByRole("navigation", { name: /case breadcrumb/i });
    expect(within(breadcrumb).getByRole("link", { name: "Cases" }).getAttribute("href")).toBe("/workspace/cases");
    const tabs = within(identity).getByRole("navigation", { name: /case pages/i });

    const assertOnly = (page: string, owned: readonly RegExp[]) => {
      const main = screen.getByRole("main", { name: /customers governed change/i });
      for (const heading of owned) expect(within(main).getByRole("heading", { name: heading })).not.toBeNull();
      const active = within(tabs).getByRole("link", { name: new RegExp(`^${page}$`, "i") });
      expect(active.getAttribute("aria-current")).toBe("page");
      expect(active.getAttribute("href")).toBe(casePath(value, page.toLowerCase()));
      return main;
    };

    let main = assertOnly("Overview", [/merge authority/i, /case stage summary/i]);
    expect(within(main).getByRole("region", { name: /case actions/i })).not.toBeNull();
    expect(within(main).queryByRole("region", { name: /governed execution graph/i })).toBeNull();
    expect(within(main).queryByRole("heading", { name: /^owner work$/i })).toBeNull();
    expect(within(main).queryByRole("heading", { name: /SHA-bound human approvals/i })).toBeNull();
    expect(within(main).queryByRole("region", { name: /QVAC coordination controls/i })).toBeNull();
    expect(within(main).queryByRole("heading", { name: /verified timeline/i })).toBeNull();

    fireEvent.click(within(tabs).getByRole("link", { name: "Work" }));
    main = assertOnly("Work", [/^owner work$/i]);
    expect(within(main).getByText(/Add a compatibility alias for the renamed column/i)).not.toBeNull();
    expect(within(main).getAllByText(/validation receipt missing/i).length).toBeGreaterThan(0);
    expect(within(main).queryByRole("region", { name: /case actions/i })).toBeNull();
    expect(within(main).queryByRole("heading", { name: /SHA-bound human approvals/i })).toBeNull();

    fireEvent.click(within(tabs).getByRole("link", { name: "Approvals" }));
    main = assertOnly("Approvals", [/SHA-bound human approvals/i]);
    expect(within(main).getAllByText(value.revision.headSha).length).toBeGreaterThan(0);
    expect(within(main).getAllByText(/submit the requested review in GitHub, then reconcile/i).length).toBeGreaterThan(0);
    expect(within(main).queryByRole("button", { name: /approve|deny/i })).toBeNull();
    expect(within(main).queryByRole("heading", { name: /^owner work$/i })).toBeNull();

    fireEvent.click(within(tabs).getByRole("link", { name: "Run" }));
    main = screen.getByRole("main", { name: /customers governed change/i });
    expect(within(tabs).getByRole("link", { name: "Run" }).getAttribute("aria-current")).toBe("page");
    expect(await within(main).findByRole("region", { name: /QVAC coordination controls/i })).not.toBeNull();
    expect(within(main).queryByRole("region", { name: /case actions/i })).toBeNull();
    expect(within(main).queryByRole("heading", { name: /SHA-bound human approvals/i })).toBeNull();

    fireEvent.click(within(tabs).getByRole("link", { name: "History" }));
    main = assertOnly("History", [/verified timeline/i, /agent run history/i]);
    expect(within(main).queryByRole("region", { name: /QVAC coordination controls/i })).toBeNull();
    expect(within(main).queryByRole("heading", { name: /^owner work$/i })).toBeNull();
    expect(listCases).toHaveBeenCalledTimes(1);
  });

  it("lazy-loads only the Graph page behind an honest state and keeps exact React Flow interaction", async () => {
    const value = caseValue();
    let finishCases: ((values: readonly ChangeCase[]) => void) | undefined;
    const cases = new Promise<readonly ChangeCase[]>((resolve) => { finishCases = resolve; });
    render(<Workspace
      client={clientFor(value, { listCases: async () => await cases })}
      route={{ kind: "case", caseKey: value.caseKey, page: "graph" }}
      onNavigate={() => undefined}
    />);

    finishCases?.([value]);
    const loading = await screen.findByRole("status", { name: /governed graph loading status/i });
    expect(loading.textContent).toMatch(/loading governed execution graph/i);

    const graph = await screen.findByRole("region", { name: /governed execution graph/i });
    expect(within(graph).getByRole("button", { name: /zoom in/i })).not.toBeNull();
    expect(within(graph).getByRole("button", { name: /zoom out/i })).not.toBeNull();
    expect(within(graph).getByLabelText(/execution graph mini map/i)).not.toBeNull();
    const inspector = within(graph).getByRole("complementary", { name: /selected execution evidence/i });
    const dataHubNode = within(graph).getByText("DataHub impact").closest<HTMLElement>(".react-flow__node");
    if (dataHubNode === null) throw new Error("DataHub React Flow node wrapper was not rendered");
    dataHubNode.focus();
    fireEvent.keyDown(dataHubNode, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(within(inspector).getByRole("heading", { name: /DataHub impact/i })).not.toBeNull());
    expect(screen.getByRole("heading", { name: /exact impact paths/i })).not.toBeNull();
    expect(screen.getByText(/email.*email/i)).not.toBeNull();
    expect(screen.queryByRole("region", { name: /case actions/i })).toBeNull();
  });

  it("paginates case-owned work at twenty-five real items without hiding missing evidence", async () => {
    const base = caseValue();
    const template = base.workItems[0]!;
    const value: ChangeCase = {
      ...base,
      workItems: Array.from({ length: 26 }, (_, index) => ({
        ...template,
        workKey: index.toString(16).padStart(24, "0"),
        title: `Governed owner work ${String(index).padStart(2, "0")}`,
      })),
      externalProjections: [],
      validationReceipts: [],
    };
    render(<App client={clientFor(value)} sessionClient={localSessionClient} initialPath={casePath(value, "work")} />);

    const work = await screen.findByRole("region", { name: /^owner work$/i });
    expect(within(work).getAllByRole("article")).toHaveLength(25);
    expect(within(work).getByText("Governed owner work 00")).not.toBeNull();
    expect(within(work).queryByText("Governed owner work 25")).toBeNull();
    expect(within(work).getAllByText(/GitHub projection missing/i)).toHaveLength(25);
    expect(screen.getByRole("status", { name: /work pagination/i }).textContent).toMatch(/Page 1 of 2.*26 rows/i);

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(within(work).getAllByRole("article")).toHaveLength(1);
    expect(within(work).getByText("Governed owner work 25")).not.toBeNull();
  });

  it("keeps every blocker reachable through an explicit twenty-five-row expansion", async () => {
    const base = caseValue();
    const blockers = Array.from({ length: 26 }, (_, index) => `BLOCKER_${String(index).padStart(2, "0")}`);
    const value: ChangeCase = {
      ...base,
      admission: {
        allowed: false,
        blockers,
        revisionKey: base.revision.revisionKey,
        headSha: base.revision.headSha,
        evaluatedAt: "2026-08-09T16:00:00.000Z",
      },
    };
    render(<App client={clientFor(value)} sessionClient={localSessionClient} initialPath={casePath(value)} />);

    const panel = (await screen.findByRole("heading", { name: /merge authority/i })).closest("section");
    if (panel === null) throw new Error("Merge authority panel was not rendered");
    expect(panel.querySelector(":scope > .blocker-list")?.children).toHaveLength(25);
    const moreBlockers = within(panel).getByText(/show 1 more blocker/i).closest("details");
    expect(moreBlockers?.open).toBe(false);
    fireEvent.click(within(moreBlockers!).getByText(/show 1 more blocker/i));
    expect(moreBlockers?.open).toBe(true);
    expect(moreBlockers?.querySelector(".blocker-list")?.children).toHaveLength(1);
    expect(within(panel).getByText("BLOCKER_25")).not.toBeNull();
  });

  it("bounds long completion criteria and GitHub decision collections with explicit expansion", async () => {
    const base = caseValue();
    const work = base.workItems[0]!;
    const requirement = base.approvalRequirements[0]!;
    const value: ChangeCase = {
      ...base,
      workItems: [{
        ...work,
        completionCriteria: Array.from({ length: 26 }, (_, index) => `Completion criterion ${String(index).padStart(2, "0")}`),
      }, ...base.workItems.slice(1)],
      approvalDecisions: Array.from({ length: 26 }, (_, index) => ({
        requirementKey: requirement.requirementKey,
        revisionKey: requirement.revisionKey,
        headSha: base.revision.headSha,
        role: requirement.role,
        ownerUrn: requirement.ownerUrn,
        actorLogin: `reviewer-${String(index).padStart(2, "0")}`,
        verdict: "approve" as const,
        decidedAt: `2026-08-09T15:00:${String(index).padStart(2, "0")}.000Z`,
        source: "github" as const,
        externalId: `review-${index}`,
        url: `https://github.com/acme/warehouse/pull/17#review-${index}`,
      })),
    };
    render(<App client={clientFor(value)} sessionClient={localSessionClient} initialPath={casePath(value, "work")} />);

    const criteria = await screen.findByRole("region", { name: /completion criteria for implement compatible producer migration/i });
    expect(criteria.querySelector(":scope > ul")?.children).toHaveLength(25);
    const moreCriteria = within(criteria).getByText(/show 1 more completion criterion/i).closest("details");
    expect(moreCriteria?.open).toBe(false);
    fireEvent.click(within(moreCriteria!).getByText(/show 1 more completion criterion/i));
    expect(moreCriteria?.open).toBe(true);
    expect(moreCriteria?.querySelector("ul")?.children).toHaveLength(1);

    fireEvent.click(within(screen.getByRole("navigation", { name: /case pages/i })).getByRole("link", { name: "Approvals" }));
    const approvals = await screen.findByRole("heading", { name: /SHA-bound human approvals/i });
    const approvalsPage = approvals.closest("section");
    if (approvalsPage === null) throw new Error("Approval page was not rendered");
    fireEvent.click(within(approvalsPage).getByText(/show 1 more GitHub decision/i));
    expect(within(approvalsPage).getByText("reviewer-25")).not.toBeNull();
  });

  it("does not present stale, duplicate, wrongly assigned, or incomplete projections as verified work", async () => {
    const base = caseValue();
    const work = base.workItems[0]!;
    const ownerMappings = base.workItems.map((item, index) => [item.ownerUrn, `expected-${index}-gh`] as [string, string]);
    const projection = base.externalProjections[0]!;
    const value: ChangeCase = {
      ...base,
      ownerMappings,
      externalProjections: [{
        ...projection,
        externalId: "stale-revision",
        url: "https://github.com/acme/warehouse/issues/stale-revision",
        revisionKey: "a".repeat(24),
        assignee: "expected-0-gh",
      }, {
        ...projection,
        externalId: "stale-head",
        url: "https://github.com/acme/warehouse/issues/stale-head",
        headSha: "previous-head",
        assignee: "expected-0-gh",
      }, {
        ...projection,
        externalId: "wrong-assignee",
        url: "https://github.com/acme/warehouse/issues/wrong-assignee",
        assignee: "unexpected-gh",
      }, {
        ...projection,
        externalId: "unverified-time",
        url: "https://github.com/acme/warehouse/issues/unverified-time",
        assignee: "expected-0-gh",
        verifiedAt: null,
      }],
    };
    render(<App client={clientFor(value)} sessionClient={localSessionClient} initialPath={casePath(value)} />);

    const summary = await screen.findByLabelText(/case summary/i);
    expect(within(summary).getByText(`0/${base.workItems.length}`)).not.toBeNull();

    fireEvent.click(within(screen.getByRole("navigation", { name: /case pages/i })).getByRole("link", { name: "Work" }));
    const projections = await screen.findByRole("region", { name: `GitHub projections for ${work.title}` });
    expect(within(projections).queryByRole("img", { name: /^Verified:/i })).toBeNull();
    expect(within(projections).getByText(/expected exactly one projection.*found 4/i)).not.toBeNull();
    expect(within(projections).getByText(/revision does not match the current governed revision/i)).not.toBeNull();
    expect(within(projections).getByText(/Git head does not match the current immutable Git head/i)).not.toBeNull();
    expect(within(projections).getByText(/assignee does not match expected GitHub actor expected-0-gh/i)).not.toBeNull();
    expect(within(projections).getByText(/projection has not been verified/i)).not.toBeNull();
  });

  it("shows approval conflicts and binding defects without calling them GitHub-verified", async () => {
    const base = caseValue();
    const requirement = base.approvalRequirements[0]!;
    const expectedActor = "required-reviewer-gh";
    const staleAt = "2026-08-09T15:00:00.000Z";
    const mismatchedAt = "2026-08-09T15:01:00.000Z";
    const value: ChangeCase = {
      ...base,
      ownerMappings: [[requirement.ownerUrn, expectedActor]],
      approvalDecisions: [{
        requirementKey: requirement.requirementKey,
        revisionKey: requirement.revisionKey,
        headSha: "previous-head",
        role: requirement.role,
        ownerUrn: requirement.ownerUrn,
        actorLogin: expectedActor,
        verdict: "reject",
        decidedAt: staleAt,
        source: "github",
        externalId: "stale-review",
        url: "https://github.com/acme/warehouse/pull/17#stale-review",
      }, {
        requirementKey: requirement.requirementKey,
        revisionKey: "b".repeat(24),
        headSha: base.revision.headSha,
        role: requirement.role === "producer" ? "consumer" : "producer",
        ownerUrn: "urn:li:corpuser:unexpected-owner",
        actorLogin: "unexpected-reviewer-gh",
        verdict: "approve",
        decidedAt: mismatchedAt,
        source: "github",
      }],
    };
    render(<App client={clientFor(value)} sessionClient={localSessionClient} initialPath={casePath(value, "approvals")} />);

    const page = (await screen.findByRole("heading", { name: /SHA-bound human approvals/i })).closest("section");
    if (page === null) throw new Error("Approval page was not rendered");
    const row = within(page).getByText(requirement.requirementKey).closest("article");
    if (row === null) throw new Error("Approval requirement row was not rendered");
    expect(within(row).queryByText(/Verified from GitHub/i)).toBeNull();
    expect(within(row).getByText(/expected exactly one decision.*found 2/i)).not.toBeNull();
    expect(within(row).getByText(/revision does not match the current governed revision/i)).not.toBeNull();
    expect(within(row).getByText(/role does not match the required role/i)).not.toBeNull();
    expect(within(row).getByText(/owner does not match the required owner URN/i)).not.toBeNull();
    expect(within(row).getByText(new RegExp(`actor does not match expected GitHub actor ${expectedActor}`, "i"))).not.toBeNull();
    expect(within(row).getByText(/GitHub provenance is incomplete/i)).not.toBeNull();
    for (const urn of requirement.affectedUrns) expect(within(row).getByText(urn)).not.toBeNull();
    expect(within(row).getByText(/verdict reject/i)).not.toBeNull();
    expect(within(row).getByText(staleAt)).not.toBeNull();
    expect(within(row).getByText(/verdict approve/i)).not.toBeNull();
    expect(within(row).getByText(mismatchedAt)).not.toBeNull();

    fireEvent.click(within(screen.getByRole("navigation", { name: /case pages/i })).getByRole("link", { name: "History" }));
    const timeline = (await screen.findByRole("heading", { name: /verified timeline/i })).closest("section");
    if (timeline === null) throw new Error("Verified timeline was not rendered");
    expect(within(timeline).queryByText(/Verified GitHub actor/i)).toBeNull();
    expect(within(timeline).getAllByText(/Unverified GitHub decision actor/i)).toHaveLength(2);
  });

  it("paginates an active run's audit events at twenty-five records", async () => {
    const value = caseValue();
    const events: AgentRunSnapshot["events"] = Array.from({ length: 26 }, (_, index) => ({
      kind: index === 0 ? "run_started" as const : "model_connected" as const,
      sequence: index + 1,
      at: `2026-08-09T15:00:${String(index).padStart(2, "0")}.000Z`,
      summary: `Active audit event ${String(index + 1).padStart(2, "0")}`,
    }));
    const snapshot: AgentRunSnapshot = {
      runId: "run-active-bounded",
      caseKey: value.caseKey,
      headSha: "a".repeat(40),
      modelId: "qwen3.6-27b",
      status: "completed",
      events,
    };
    render(<App
      client={clientFor(value, { startAgent: async () => snapshot })}
      sessionClient={localSessionClient}
      initialPath={casePath(value, "run")}
    />);

    fireEvent.click(await screen.findByRole("button", { name: /Run QVAC coordinator/i }));
    const audit = await screen.findByRole("list", { name: /^Agent audit events$/i });
    expect(audit.children).toHaveLength(25);
    expect(within(audit).getByText("Active audit event 25")).not.toBeNull();
    expect(screen.queryByText("Active audit event 26")).toBeNull();
    expect(screen.getByRole("status", { name: /Agent audit events pagination/i }).textContent).toMatch(/Page 1 of 2.*26 events/i);

    fireEvent.click(screen.getByRole("button", { name: /Next Agent audit events page/i }));
    expect(audit.children).toHaveLength(1);
    expect(within(audit).getByText("Active audit event 26")).not.toBeNull();
  });

  it("paginates each history run's audit events independently at twenty-five records", async () => {
    const base = caseValue();
    const events: ChangeCase["agentRuns"][number]["events"] = Array.from({ length: 26 }, (_, index) => ({
      kind: index === 0 ? "run_started" as const : "model_connected" as const,
      sequence: index + 1,
      at: `2026-08-09T16:00:${String(index).padStart(2, "0")}.000Z`,
      summary: `Historical audit event ${String(index + 1).padStart(2, "0")}`,
    }));
    const value: ChangeCase = {
      ...base,
      agentRuns: [{
        runId: "run-history-bounded",
        caseKey: base.caseKey,
        revisionKey: base.revision.revisionKey,
        headSha: base.revision.headSha,
        modelId: "qwen3.6-27b",
        status: "completed",
        events,
        createdAt: events[0]!.at,
        updatedAt: events.at(-1)!.at,
      }],
    };
    render(<App client={clientFor(value)} sessionClient={localSessionClient} initialPath={casePath(value, "history")} />);

    const group = (await screen.findByText("run-history-bounded")).closest("details");
    if (group === null) throw new Error("Historical run disclosure was not rendered");
    fireEvent.click(within(group).getByText("run-history-bounded"));
    const audit = within(group).getByRole("list", { name: /Durable agent audit for run-history-bounded/i });
    expect(audit.children).toHaveLength(25);
    expect(within(audit).getByText("Historical audit event 25")).not.toBeNull();
    expect(within(group).queryByText("Historical audit event 26")).toBeNull();

    fireEvent.click(within(group).getByRole("button", { name: /Next Durable agent audit for run-history-bounded page/i }));
    expect(audit.children).toHaveLength(1);
    expect(within(audit).getByText("Historical audit event 26")).not.toBeNull();
  });

  it("keeps tool and run failures visible in a history summary regardless of overall run status", async () => {
    const base = caseValue();
    const value: ChangeCase = {
      ...base,
      agentRuns: [{
        runId: "run-completed-with-failure",
        caseKey: base.caseKey,
        revisionKey: base.revision.revisionKey,
        headSha: base.revision.headSha,
        modelId: "qwen3.6-27b",
        status: "completed",
        events: [{
          kind: "run_started", sequence: 1, at: "2026-08-09T17:00:00.000Z", summary: "Run started",
        }, {
          kind: "tool_failed", sequence: 2, at: "2026-08-09T17:01:00.000Z", summary: "GitHub reconciliation failed closed",
          toolName: "reconcileGitHubWork", toolCallId: "call-failed",
        }, {
          kind: "run_completed", sequence: 3, at: "2026-08-09T17:02:00.000Z", summary: "Coordinator returned",
        }],
        createdAt: "2026-08-09T17:00:00.000Z",
        updatedAt: "2026-08-09T17:02:00.000Z",
      }],
    };
    render(<App client={clientFor(value)} sessionClient={localSessionClient} initialPath={casePath(value, "history")} />);

    const group = (await screen.findByText("run-completed-with-failure")).closest("details");
    if (group === null) throw new Error("Historical run disclosure was not rendered");
    expect(group.open).toBe(false);
    expect(group.querySelector(":scope > summary")?.textContent).toMatch(/GitHub reconciliation failed closed/i);
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
      }, {
        runId: "run-durable-failed", caseKey: value.caseKey, revisionKey: value.revision.revisionKey,
        headSha: value.revision.headSha, modelId: "qwen3.6-27b", status: "failed",
        events: [
          { kind: "run_started", sequence: 1, at: "2026-08-09T16:00:00.000Z", summary: "Governed run started" },
          { kind: "tool_failed", sequence: 2, at: "2026-08-09T16:01:00.000Z", summary: "DataHub write-back failed closed", toolName: "publishMergeDecision", toolCallId: "call-failed" },
          { kind: "run_failed", sequence: 3, at: "2026-08-09T16:02:00.000Z", summary: "Run stopped without verified completion" },
        ],
        createdAt: "2026-08-09T16:00:00.000Z", updatedAt: "2026-08-09T16:02:00.000Z",
      }],
    };
    const client: WorkspaceClient = {
      listCases: async () => [audited], getCase: async () => audited, sync: async () => audited,
      reconcile: async () => audited, decide: async () => audited,
      agentHealth: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
      startAgent: async () => { throw new Error("not used"); },
      approveAgent: async () => { throw new Error("not used"); },
    };

    render(<App client={client} sessionClient={localSessionClient} initialPath={casePath(audited, "history")} />);

    const completedRun = await screen.findByText("run-durable-1");
    const disclosure = completedRun.closest("details");
    expect(disclosure?.open).toBe(false);
    const failedRun = screen.getByText("run-durable-failed").closest("details");
    expect(failedRun?.textContent).toMatch(/Run stopped without verified completion/i);
    fireEvent.click(within(disclosure!).getByText("run-durable-1"));
    const audit = await within(disclosure!).findByRole("list", { name: /durable agent audit/i });
    expect(disclosure?.textContent).toContain("qwen3.6-27b");
    expect(audit.textContent).toContain("tool approved");
    expect(audit.textContent).toContain("Approved exact arguments");
    expect(screen.queryByRole("button", { name: /Approve generateRemediation/i })).toBeNull();
  });

  it("renders governed work with real projections and missing receipts", async () => {
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
    render(<App client={client} sessionClient={localSessionClient} initialPath={casePath(value, "work")} />);

    expect(screen.getByText("Verifying operator session…")).not.toBeNull();
    await waitFor(() => expect(screen.getByRole("heading", { name: /customers/i })).not.toBeNull());
    expect(screen.getByText("ChangeMarshal")).not.toBeNull();
    expect(screen.queryByText("Cutset")).toBeNull();
    expect(screen.getByLabelText("email → email_address")).not.toBeNull();
    expect(screen.getAllByText("orders").length).toBeGreaterThan(0);
    expect(screen.getByText(/Implement compatible producer migration/)).not.toBeNull();
    expect(screen.getAllByText(/validation receipt missing/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Open GitHub issue/i }).getAttribute("href"))
      .toBe("https://github.com/acme/warehouse/issues/1");
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
  });

  it.each([
    ["Enter", "Enter"],
    ["Space", " "],
  ] as const)("keeps the evidence inspector synchronized with %s node selection", async (_label, key) => {
    const value = caseValue();
    render(<App client={clientFor(value)} sessionClient={localSessionClient} initialPath={casePath(value, "graph")} />);

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
    const sections = within(workspace).getByRole("navigation", { name: /case pages/i });
    expect(within(sections).getByRole("link", { name: /graph/i }).getAttribute("href")).toBe(casePath(value, "graph"));

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
      initialPath={casePath(value, "run")}
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
    render(<App client={client} sessionClient={localSessionClient} initialPath={casePath(value, "run")} />);

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
    render(<App client={client} sessionClient={localSessionClient} initialPath={casePath(value, "run")} />);

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
    render(<App client={client} sessionClient={localSessionClient} initialPath={casePath(caseA, "run")} />);

    fireEvent.click(await screen.findByRole("button", { name: /Run QVAC coordinator/i }));
    await screen.findByRole("group", { name: /Approval required for generateRemediation/i });
    fireEvent.change(screen.getByRole("searchbox", { name: /find a governed case/i }), { target: { value: "campaigns" } });
    fireEvent.click(screen.getByRole("link", { name: /campaigns.*acme\/marketing/i }));
    await screen.findByRole("heading", { name: /campaigns governed change/i });
    expect(screen.queryByRole("group", { name: /Approval required for generateRemediation/i })).toBeNull();

    window.history.pushState({}, "", casePath(caseA, "run"));
    fireEvent(window, new PopStateEvent("popstate"));
    await screen.findByRole("heading", { name: /customers governed change/i });

    const gate = screen.getByRole("group", { name: /Approval required for generateRemediation/i });
    expect(gate.textContent).toContain(caseA.caseKey);
    expect(gate.textContent).toContain(caseA.repository);
    expect(gate.textContent).toContain(pending.headSha);
    expect(gate.textContent).not.toContain(caseB.repository);

    fireEvent.click(within(gate).getByRole("button", { name: /Approve generateRemediation/i }));
    await waitFor(() => expect(getCase).toHaveBeenLastCalledWith(caseA.caseKey));
    expect(screen.getByRole("heading", { name: /customers governed change/i })).not.toBeNull();
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
    render(<App client={client} sessionClient={localSessionClient} initialPath={casePath(value, "run")} />);

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
