import { expect, it } from "vitest";
import { resolve } from "node:path";

import { DataHubCaseStore } from "../../src/datahub/case-store";
import { collectEvidence } from "../../src/datahub/evidence";
import {
  DataHubMcpClient,
  type DataHubMcpConfig,
} from "../../src/datahub/mcp-client";
import { compileCase } from "../../src/domain/compile-case";
import { readCommitTimestamp, resolveRevision } from "../../src/git/repository";

function liveConfig(): DataHubMcpConfig | undefined {
  const url = process.env.CUTSET_DATAHUB_MCP_URL;
  if (url) {
    const token = process.env.CUTSET_DATAHUB_MCP_TOKEN;
    return {
      kind: "http",
      url,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    };
  }
  const command = process.env.CUTSET_DATAHUB_MCP_COMMAND;
  if (!command) return undefined;
  const argsValue = process.env.CUTSET_DATAHUB_MCP_ARGS;
  const args = argsValue === undefined ? [] : JSON.parse(argsValue) as unknown;
  if (!Array.isArray(args) || !args.every((value) => typeof value === "string")) {
    throw new Error("CUTSET_DATAHUB_MCP_ARGS must be a JSON string array");
  }
  const env = Object.fromEntries(
    [
      "DATAHUB_GMS_URL",
      "DATAHUB_GMS_TOKEN",
      "TOOLS_IS_MUTATION_ENABLED",
      "DATA_QUALITY_TOOLS_ENABLED",
      "SAVE_DOCUMENT_TOOL_ENABLED",
      "SAVE_DOCUMENT_RESTRICT_UPDATES",
    ]
      .map((name) => [name, process.env[name]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
  );
  return { kind: "stdio", command, args, env };
}

const config = liveConfig();
const modelName = process.env.CUTSET_INTEGRATION_MODEL;
const oldName = process.env.CUTSET_INTEGRATION_OLD_COLUMN;
const live = config !== undefined && modelName !== undefined && oldName !== undefined;

async function liveEvidence(client: DataHubMcpClient) {
  return await collectEvidence(client, {
    kind: "dbt_column_rename" as const,
    modelName: modelName as string,
    oldName: oldName as string,
    newName: process.env.CUTSET_INTEGRATION_NEW_COLUMN ?? `${oldName as string}_renamed`,
    sourcePath: process.env.CUTSET_INTEGRATION_SCHEMA_PATH ?? "models/schema.yml",
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
    const expectedUrn = process.env.CUTSET_INTEGRATION_DATASET_URN;
    if (expectedUrn !== undefined) expect(evidence.source.urn).toBe(expectedUrn);
  } finally {
    await client.close();
  }
}, 180_000);

const liveWriteback = live && process.env.CUTSET_INTEGRATION_WRITEBACK === "1";

(liveWriteback ? it : it.skip)("writes and idempotently updates a real DataHub change-case document", async () => {
  const client = await DataHubMcpClient.connect(config as DataHubMcpConfig);
  try {
    const evidence = await liveEvidence(client);
    const repo = process.env.CUTSET_INTEGRATION_GIT_REPOSITORY ?? resolve(import.meta.dirname, "../../..");
    const headSha = await resolveRevision(repo, "HEAD");
    const baseSha = await resolveRevision(repo, "HEAD^");
    const observedAt = await readCommitTimestamp(repo, headSha);
    const value = compileCase(evidence, {
      repository: process.env.CUTSET_INTEGRATION_REPOSITORY_ID ?? "cutset-live-integration",
      baseSha,
      headSha,
      observedAt,
      change: {
        kind: "dbt_column_rename",
        modelName: modelName as string,
        oldName: oldName as string,
        newName: process.env.CUTSET_INTEGRATION_NEW_COLUMN ?? `${oldName as string}_renamed`,
        sourcePath: process.env.CUTSET_INTEGRATION_SCHEMA_PATH ?? "models/schema.yml",
      },
    });
    const store = new DataHubCaseStore(client);
    const first = await store.saveAndVerifyCase(value, observedAt);
    const second = await store.saveAndVerifyCase(value, observedAt);
    expect(first.dataHub.verified).toBe(true);
    expect(second.dataHub.documentUrn).toBe(first.dataHub.documentUrn);
    expect(second.contentHash).toBe(first.contentHash);
  } finally {
    await client.close();
  }
}, 240_000);
