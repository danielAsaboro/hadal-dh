import { describe, expect, it } from "vitest";

import type { ChangeCase, ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import { createServer, type CaseApplication } from "../../src/server/app";

function currentCase(): ChangeCase {
  const source = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
  const evidence: ImpactEvidence = {
    complete: true,
    source: { urn: source, type: "dataset", name: "customers" }, schemaFields: ["email"], paths: [],
    assets: [{ urn: source, type: "dataset", name: "customers", owners: ["urn:li:corpuser:producer"], tags: [], glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete: true }],
  };
  return compileCase(evidence, {
    repository: "acme/warehouse", baseSha: "base", headSha: "head", observedAt: "2026-08-09T10:00:00.000Z",
    change: { kind: "dbt_column_rename", modelName: "customers", oldName: "email", newName: "email_address", sourcePath: "models/schema.yml" },
  });
}

describe("coordination API", () => {
  it("returns only canonical cases and exposes no connector secrets", async () => {
    const value = currentCase();
    const application: CaseApplication = {
      list: async () => [value], show: async () => value,
      syncWork: async () => value, reconcileWork: async () => value,
      decide: async () => value,
      updateOwnerMappings: async () => value,
      recordReceipt: async () => value,
    };
    const server = createServer({ application, github: () => ({ token: "must-not-leak" }) as never });

    const index = await server.inject({ method: "GET", url: "/api/cases" });
    const detail = await server.inject({ method: "GET", url: `/api/cases/${value.caseKey}` });
    const health = await server.inject({ method: "GET", url: "/api/health" });

    expect(index.statusCode).toBe(200);
    expect(index.json()).toEqual([value]);
    expect(detail.json()).toEqual(value);
    expect(health.json()).toEqual({ ok: true, service: "changemarshal" });
    expect(`${index.body}${detail.body}`).not.toContain("must-not-leak");
    await server.close();
  });

  it("reconciles GitHub reviews through the server-owned connector and exposes no direct approval route", async () => {
    const value = currentCase();
    let connectorReceived: unknown;
    const application: CaseApplication = {
      list: async () => [value], show: async () => value,
      syncWork: async () => value,
      reconcileWork: async (_key, connector) => { connectorReceived = connector; return value; },
      decide: async () => value, updateOwnerMappings: async () => value,
      recordReceipt: async () => value,
    };
    const connector = { reconcileApprovals: async () => [] };
    const server = createServer({ application, github: () => connector as never });
    const reconciled = await server.inject({ method: "POST", url: `/api/cases/${value.caseKey}/reconcile`, payload: {} });
    const directApproval = await server.inject({ method: "POST", url: `/api/cases/${value.caseKey}/approve`, payload: {
      requirementKey: value.approvalRequirements[0]!.requirementKey,
    } });

    expect(reconciled.statusCode).toBe(200);
    expect(connectorReceived).toBe(connector);
    expect(directApproval.statusCode).toBe(404);
    await server.close();
  });
});
