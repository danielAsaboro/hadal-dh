import { describe, expect, it } from "vitest";

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentRunCoordinator } from "../../src/ai/run-coordinator";
import type { AgentRunSnapshot } from "../../src/ai/run-events";
import type { ChangeCase, ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import { createServer, type AgentRunApplication } from "../../src/server/app";

function completeCase(baseSha = "a".repeat(40), headSha = "b".repeat(40), repository = "acme/warehouse"): ChangeCase {
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
    repository, baseSha, headSha,
    observedAt: "2026-08-09T10:00:00.000Z",
    change: { kind: "dbt_column_rename", modelName: "customers", oldName: "email", newName: "email_address", sourcePath: "models/schema.yml" },
  });
}

function realRepository(): Readonly<{ root: string; baseSha: string; headSha: string }> {
  const root = mkdtempSync(join(tmpdir(), "changemarshal-agent-api-"));
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "agent-api@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Agent API Test"]);
  writeFileSync(join(root, "schema.yml"), "email: string\n");
  execFileSync("git", ["-C", root, "add", "schema.yml"]);
  execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "base"]);
  const baseSha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  writeFileSync(join(root, "schema.yml"), "email_address: string\n");
  execFileSync("git", ["-C", root, "add", "schema.yml"]);
  execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "head"]);
  const headSha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { root, baseSha, headSha };
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
    const repository = realRepository();
    const value = completeCase(repository.baseSha, repository.headSha);
    const server = createServer({
      application: {
        list: async () => [value], show: async () => value,
        syncWork: async () => value, reconcileWork: async () => value,
        updateOwnerMappings: async () => value, recordReceipt: async () => value, decide: async () => value,
      },
      github: () => { throw new Error("not used"); },
      repoRoot: repository.root,
      agent: agentApplication(),
      agentScope: { repository: value.repository, baseRef: repository.baseSha, headRef: repository.headSha },
    });
    try {
      const started = await server.inject({
        method: "POST", url: "/api/agent/runs", payload: { caseKey: value.caseKey, prompt: "Inspect this governed case." },
      });
      expect(started.statusCode).toBe(202);
      const snapshot = started.json<AgentRunSnapshot>();
      const events = await server.inject({ method: "GET", url: `/api/agent/runs/${snapshot.runId}/events` });
      expect(events.headers["content-type"]).toContain("text/event-stream");
      expect(events.body).toContain('"kind":"run_started"');
      expect(events.body).toContain('"sequence":2');
    } finally {
      await server.close();
      rmSync(repository.root, { recursive: true, force: true });
    }
  });

  it("rejects a case outside the configured repository scope before starting the model", async () => {
    const repository = realRepository();
    const value = completeCase(repository.baseSha, repository.headSha, "other/warehouse");
    const server = createServer({
      application: {
        list: async () => [value], show: async () => value,
        syncWork: async () => value, reconcileWork: async () => value,
        updateOwnerMappings: async () => value, recordReceipt: async () => value, decide: async () => value,
      },
      github: () => { throw new Error("not used"); },
      repoRoot: repository.root,
      agent: agentApplication(),
      agentScope: { repository: "acme/warehouse", baseRef: repository.baseSha, headRef: repository.headSha },
    });
    try {
      const response = await server.inject({
        method: "POST", url: "/api/agent/runs", payload: { caseKey: value.caseKey, prompt: "Inspect this governed case." },
      });
      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({ message: "governed case repository does not match the QVAC agent scope" });
    } finally {
      await server.close();
      rmSync(repository.root, { recursive: true, force: true });
    }
  });

  it("rejects a run when the live checkout moved beyond the configured head", async () => {
    const repository = realRepository();
    const value = completeCase(repository.baseSha, repository.headSha);
    writeFileSync(join(repository.root, "README.md"), "checkout moved\n");
    execFileSync("git", ["-C", repository.root, "add", "README.md"]);
    execFileSync("git", ["-C", repository.root, "commit", "--quiet", "-m", "unexpected head"]);
    const server = createServer({
      application: {
        list: async () => [value], show: async () => value,
        syncWork: async () => value, reconcileWork: async () => value,
        updateOwnerMappings: async () => value, recordReceipt: async () => value, decide: async () => value,
      },
      github: () => { throw new Error("not used"); },
      repoRoot: repository.root,
      agent: agentApplication(),
      agentScope: { repository: value.repository, baseRef: repository.baseSha, headRef: repository.headSha },
    });
    try {
      const response = await server.inject({
        method: "POST", url: "/api/agent/runs", payload: { caseKey: value.caseKey, prompt: "Inspect this governed case." },
      });
      expect(response.statusCode).toBe(502);
      expect(response.json()).toMatchObject({ message: "repository HEAD changed after the governed QVAC scope was configured" });
    } finally {
      await server.close();
      rmSync(repository.root, { recursive: true, force: true });
    }
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
