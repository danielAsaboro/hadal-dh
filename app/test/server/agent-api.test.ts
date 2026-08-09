import { describe, expect, it } from "vitest";

import { AgentRunCoordinator } from "../../src/ai/run-coordinator";
import type { AgentRunSnapshot } from "../../src/ai/run-events";
import type { ChangeCase, ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import { createServer, type AgentRunApplication } from "../../src/server/app";

function completeCase(): ChangeCase {
  const source = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
  const evidence: ImpactEvidence = {
    complete: true,
    source: { urn: source, type: "dataset", name: "customers" },
    schemaFields: ["email"], paths: [],
    assets: [{
      urn: source, type: "dataset", name: "customers", owners: ["urn:li:corpuser:producer"],
      tags: [], glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete: true,
    }],
  };
  return compileCase(evidence, {
    repository: "acme/warehouse", baseSha: "a".repeat(40), headSha: "b".repeat(40),
    observedAt: "2026-08-09T10:00:00.000Z",
    change: { kind: "dbt_column_rename", modelName: "customers", oldName: "email", newName: "email_address", sourcePath: "models/schema.yml" },
  });
}

function agentApplication(): AgentRunApplication {
  let id = 0;
  const runs = new AgentRunCoordinator({
    now: () => new Date("2026-08-09T14:00:00.000Z"),
    id: (prefix) => `${prefix}-${++id}`,
  });
  return {
    health: async () => ({ available: true, provider: "qvac", modelId: "qwen3.6-27b", managed: true }),
    start: async ({ caseKey, headSha, prompt }) => runs.start({ caseKey, headSha, prompt, modelId: "qwen3.6-27b" }),
    show: async (runId) => runs.show(runId),
    resolveApproval: async () => { throw new Error("unknown approval token"); },
  };
}

describe("governed agent HTTP API", () => {
  it("starts a case and exposes ordered SSE evidence", async () => {
    const value = completeCase();
    const server = createServer({
      application: {
        list: async () => [value], show: async () => value,
        syncWork: async () => value, reconcileWork: async () => value,
        updateOwnerMappings: async () => value, recordReceipt: async () => value, decide: async () => value,
      },
      github: () => { throw new Error("not used"); },
      agent: agentApplication(),
    });

    const started = await server.inject({
      method: "POST", url: "/api/agent/runs", payload: { caseKey: value.caseKey, prompt: "Inspect this governed case." },
    });
    expect(started.statusCode).toBe(202);
    const snapshot = started.json<AgentRunSnapshot>();
    const events = await server.inject({ method: "GET", url: `/api/agent/runs/${snapshot.runId}/events` });
    expect(events.headers["content-type"]).toContain("text/event-stream");
    expect(events.body).toContain('"kind":"run_started"');
    expect(events.body).toContain('"sequence":2');
    await server.close();
  });

  it("fails closed when the agent runtime is not configured", async () => {
    const value = completeCase();
    const server = createServer({
      application: {
        list: async () => [value], show: async () => value,
        syncWork: async () => value, reconcileWork: async () => value,
        updateOwnerMappings: async () => value, recordReceipt: async () => value, decide: async () => value,
      },
      github: () => { throw new Error("not used"); },
    });
    expect((await server.inject({ method: "GET", url: "/api/agent/health" })).statusCode).toBe(503);
    await server.close();
  });
});
