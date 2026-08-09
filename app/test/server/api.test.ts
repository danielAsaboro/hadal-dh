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
      approve: async () => value, decide: async () => value,
      updateOwnerMappings: async () => value,
      recordReceipt: async () => value,
    };
    const server = createServer({ application, github: () => ({ token: "must-not-leak" }) as never });

    const index = await server.inject({ method: "GET", url: "/api/cases" });
    const detail = await server.inject({ method: "GET", url: `/api/cases/${value.caseKey}` });

    expect(index.statusCode).toBe(200);
    expect(index.json()).toEqual([value]);
    expect(detail.json()).toEqual(value);
    expect(`${index.body}${detail.body}`).not.toContain("must-not-leak");
    await server.close();
  });

  it("verifies approvals through the server-owned GitHub connector and rejects client actor claims", async () => {
    const value = currentCase();
    let connectorReceived: unknown;
    const application: CaseApplication = {
      list: async () => [value], show: async () => value,
      syncWork: async () => value, reconcileWork: async () => value,
      approve: async (_key, _input, connector) => { connectorReceived = connector; return value; },
      decide: async () => value, updateOwnerMappings: async () => value,
      recordReceipt: async () => value,
    };
    const connector = { verifyActor: async () => ({ login: "verified", permission: "write" }) };
    const server = createServer({ application, github: () => connector as never });
    const requirement = value.approvalRequirements[0]!;
    const accepted = await server.inject({ method: "POST", url: `/api/cases/${value.caseKey}/approve`, payload: {
      requirementKey: requirement.requirementKey, verdict: "approve", currentHeadSha: "head",
    } });
    const rejected = await server.inject({ method: "POST", url: `/api/cases/${value.caseKey}/approve`, payload: {
      requirementKey: requirement.requirementKey, verdict: "approve", currentHeadSha: "head", actorLogin: "claimed",
    } });

    expect(accepted.statusCode).toBe(200);
    expect(connectorReceived).toBe(connector);
    expect(rejected.statusCode).toBe(400);
    await server.close();
  });
});
