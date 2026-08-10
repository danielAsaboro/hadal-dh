import { expect, it } from "vitest";
import { resolve } from "node:path";

import { CasesService } from "../../src/application/cases";
import { dataHubMcpConfigFromEnv, productEnv } from "../../src/config";
import { DataHubCaseStore } from "../../src/datahub/case-store";
import { collectEvidence } from "../../src/datahub/evidence";
import {
  DataHubMcpClient,
  type DataHubMcpConfig,
} from "../../src/datahub/mcp-client";
import { compileCase } from "../../src/domain/compile-case";
import { readCommitTimestamp, resolveRevision } from "../../src/git/repository";

function liveConfig(): DataHubMcpConfig | undefined {
  if (!productEnv(process.env, "DATAHUB_MCP_URL") && !productEnv(process.env, "DATAHUB_MCP_COMMAND")) return undefined;
  return dataHubMcpConfigFromEnv();
}

const config = liveConfig();
const modelName = productEnv(process.env, "INTEGRATION_MODEL");
const oldName = productEnv(process.env, "INTEGRATION_OLD_COLUMN");
const live = config !== undefined && modelName !== undefined && oldName !== undefined;

async function liveEvidence(client: DataHubMcpClient) {
  return await collectEvidence(client, {
    kind: "dbt_column_rename" as const,
    modelName: modelName as string,
    oldName: oldName as string,
    newName: productEnv(process.env, "INTEGRATION_NEW_COLUMN") ?? `${oldName as string}_renamed`,
    sourcePath: productEnv(process.env, "INTEGRATION_SCHEMA_PATH") ?? "models/schema.yml",
  });
}

(live ? it : it.skip)("collects evidence through a real DataHub MCP server", async () => {
  const client = await DataHubMcpClient.connect(config as DataHubMcpConfig);
  try {
    const evidence = await liveEvidence(client);
    expect(evidence.complete).toBe(true);
    expect(evidence.schemaFields).toContain(oldName);
    expect(evidence.paths.length).toBeGreaterThan(0);
    expect(evidence.assets.some((asset) => asset.type === "mlModel")).toBe(true);
    expect(evidence.paths.some((path) => path.nodes.length >= 4)).toBe(true);
    const expectedUrn = productEnv(process.env, "INTEGRATION_DATASET_URN");
    if (expectedUrn !== undefined) expect(evidence.source.urn).toBe(expectedUrn);
  } finally {
    await client.close();
  }
}, 180_000);

const liveWriteback = live && productEnv(process.env, "INTEGRATION_WRITEBACK") === "1";

(liveWriteback ? it : it.skip)("writes and idempotently updates a real DataHub change-case document", async () => {
  const client = await DataHubMcpClient.connect(config as DataHubMcpConfig);
  try {
    const evidence = await liveEvidence(client);
    const repo = productEnv(process.env, "INTEGRATION_GIT_REPOSITORY") ?? resolve(import.meta.dirname, "../../..");
    const headSha = await resolveRevision(repo, "HEAD");
    const baseSha = await resolveRevision(repo, "HEAD^");
    const observedAt = await readCommitTimestamp(repo, headSha);
    const value = compileCase(evidence, {
      repository: productEnv(process.env, "INTEGRATION_REPOSITORY_ID") ?? "change-marshal-live-integration",
      baseSha,
      headSha,
      observedAt,
      change: {
        kind: "dbt_column_rename",
        modelName: modelName as string,
        oldName: oldName as string,
        newName: productEnv(process.env, "INTEGRATION_NEW_COLUMN") ?? `${oldName as string}_renamed`,
        sourcePath: productEnv(process.env, "INTEGRATION_SCHEMA_PATH") ?? "models/schema.yml",
      },
    });
    const store = new DataHubCaseStore(client);
    const first = await store.saveAndVerifyCase(value, observedAt);
    const second = await store.saveAndVerifyCase(value, observedAt);
    expect(first.dataHub.verified).toBe(true);
    expect(second.dataHub.documentUrn).toBe(first.dataHub.documentUrn);
    expect(second.contentHash).toBe(first.contentHash);

    const service = new CasesService({ collect: async () => evidence }, store);
    const auditStartedAt = new Date(observedAt).toISOString();
    const auditAt = new Date(Date.parse(observedAt) + 1_000).toISOString();
    const withAudit = await service.recordAgentRun(value.caseKey, {
      runId: `live-datahub-${headSha.slice(0, 12)}`,
      caseKey: value.caseKey,
      revisionKey: value.revision.revisionKey,
      headSha,
      modelId: "live-datahub-writeback-proof",
      status: "completed",
      events: [
        { kind: "run_started", sequence: 1, at: auditStartedAt, summary: "Live durable audit write-back started" },
        { kind: "run_completed", sequence: 2, at: auditAt, summary: "Live durable audit write-back verified" },
      ],
      answer: "DataHub accepted and returned this token-free audit record.",
      createdAt: auditStartedAt,
      updatedAt: auditAt,
    }, auditAt);
    const reread = await service.show(value.caseKey);
    expect(reread.dataHub.documentUrn).toBe(first.dataHub.documentUrn);
    expect(reread.agentRuns).toEqual(withAudit.agentRuns);
    expect(reread.agentRuns.some((run) => run.modelId === "live-datahub-writeback-proof")).toBe(true);
    expect(JSON.stringify(reread.agentRuns)).not.toContain('"token":');
  } finally {
    await client.close();
  }
}, 240_000);
