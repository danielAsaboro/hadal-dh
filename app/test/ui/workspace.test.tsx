// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChangeCase, ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import { App, type WorkspaceClient } from "../../src/ui/App";

class TestResizeObserver implements ResizeObserver {
  readonly observe = () => undefined;
  readonly unobserve = () => undefined;
  readonly disconnect = () => undefined;
}
globalThis.ResizeObserver = TestResizeObserver;

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
  it("renders governed evidence, work, approvals, blockers, and real projections", async () => {
    const value = caseValue();
    const client: WorkspaceClient = {
      listCases: async () => [value],
      getCase: async () => value,
      sync: async () => value,
      reconcile: async () => value,
      decide: async () => value,
    };
    render(<App client={client} />);

    expect(screen.getByText("Loading governed cases…")).not.toBeNull();
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
});
