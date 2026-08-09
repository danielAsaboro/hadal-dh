import { describe, expect, it } from "vitest";

import type { ChangeCase, ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import { projectCaseFlow } from "../../src/ui/flow-model";

function blockedCase(): ChangeCase {
  const source = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
  const consumer = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.orders,PROD)";
  const evidence: ImpactEvidence = {
    complete: true,
    source: { urn: source, type: "dataset", name: "customers" }, schemaFields: ["email"],
    paths: [{ sourceUrn: source, downstreamUrn: consumer, column: "email", downstreamColumns: ["email"], nodes: [source, consumer] }],
    assets: [
      { urn: source, type: "dataset", name: "customers", owners: ["urn:li:corpuser:producer"], tags: [], glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete: true },
      { urn: consumer, type: "dataset", name: "orders", owners: ["urn:li:corpuser:consumer"], tags: [], glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete: true },
    ],
  };
  const value = compileCase(evidence, {
    repository: "acme/warehouse", baseSha: "a".repeat(40), headSha: "b".repeat(40),
    observedAt: "2026-08-09T10:00:00.000Z",
    change: { kind: "dbt_column_rename", modelName: "customers", oldName: "email", newName: "email_address", sourcePath: "models/schema.yml" },
  });
  return {
    ...value,
    admission: {
      allowed: false, blockers: ["APPROVAL_MISSING"], revisionKey: value.revision.revisionKey,
      headSha: value.revision.headSha, evaluatedAt: "2026-08-09T10:01:00.000Z",
    },
  };
}

describe("canonical case execution graph", () => {
  it("projects every governed stage in deterministic left-to-right order", () => {
    const flow = projectCaseFlow(blockedCase());
    expect(flow.nodes.map(({ id }) => id)).toEqual([
      "git", "datahub", "case", "work", "approvals", "remediation", "validation", "decision", "resolution",
    ]);
    expect(flow.nodes.map(({ position }) => position.x)).toEqual([...flow.nodes.map(({ position }) => position.x)].sort((a, b) => a - b));
    expect(flow.edges).toHaveLength(8);
    expect(flow.edges.every(({ source, target }) => source !== target)).toBe(true);
  });

  it("derives blocked and waiting states only from canonical case evidence", () => {
    const flow = projectCaseFlow(blockedCase());
    expect(flow.nodes.find(({ id }) => id === "git")?.data.status).toBe("verified");
    expect(flow.nodes.find(({ id }) => id === "approvals")?.data.status).toBe("waiting");
    expect(flow.nodes.find(({ id }) => id === "decision")?.data.status).toBe("blocked");
    expect(flow.nodes.find(({ id }) => id === "resolution")?.data.status).toBe("waiting");
  });
});
