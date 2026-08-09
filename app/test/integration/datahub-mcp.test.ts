import { expect, it } from "vitest";

import { collectEvidence } from "../../src/datahub/evidence";
import {
  DataHubMcpClient,
  type DataHubMcpConfig,
} from "../../src/datahub/mcp-client";

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
    ["DATAHUB_GMS_URL", "DATAHUB_GMS_TOKEN"]
      .map((name) => [name, process.env[name]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
  );
  return { kind: "stdio", command, args, env };
}

const config = liveConfig();
const modelName = process.env.CUTSET_INTEGRATION_MODEL;
const oldName = process.env.CUTSET_INTEGRATION_OLD_COLUMN;
const live = config !== undefined && modelName !== undefined && oldName !== undefined;

(live ? it : it.skip)("collects evidence through a real DataHub MCP server", async () => {
  const client = await DataHubMcpClient.connect(config as DataHubMcpConfig);
  try {
    const evidence = await collectEvidence(client, {
      kind: "dbt_column_rename",
      modelName: modelName as string,
      oldName: oldName as string,
      newName: process.env.CUTSET_INTEGRATION_NEW_COLUMN ?? `${oldName as string}_renamed`,
      sourcePath: process.env.CUTSET_INTEGRATION_SCHEMA_PATH ?? "models/schema.yml",
    });
    expect(evidence.complete).toBe(true);
    expect(evidence.schemaFields).toContain(oldName);
    expect(evidence.paths.length).toBeGreaterThan(0);
    const expectedUrn = process.env.CUTSET_INTEGRATION_DATASET_URN;
    if (expectedUrn !== undefined) expect(evidence.source.urn).toBe(expectedUrn);
  } finally {
    await client.close();
  }
}, 60_000);
