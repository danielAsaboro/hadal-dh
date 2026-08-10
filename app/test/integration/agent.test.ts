import { it, expect } from "vitest";

import { coordinationModel } from "../../src/ai/coordination-brief";
import { createAgentOperations } from "../../src/ai/operations";
import { createChangeMarshalAgent } from "../../src/ai/orchestrator";
import { CasesService, type StatusSurface, type WorkSurface } from "../../src/application/cases";
import { aiConfigFromEnv, dataHubMcpConfigFromEnv, productEnv } from "../../src/config";
import { DataHubCaseStore } from "../../src/datahub/case-store";
import { collectEvidence } from "../../src/datahub/evidence";
import { DataHubMcpClient } from "../../src/datahub/mcp-client";

const live = productEnv(process.env, "AGENT_LIVE") === "1";

const forbiddenWorkSurface: WorkSurface & StatusSurface = {
  syncWork: async () => { throw new Error("live read-only agent attempted GitHub mutation"); },
  reconcileWork: async () => { throw new Error("live read-only agent attempted GitHub mutation"); },
  syncApprovalRequests: async () => { throw new Error("live read-only agent attempted GitHub mutation"); },
  reconcileApprovals: async () => { throw new Error("live read-only agent attempted GitHub mutation"); },
  publishAndVerifyStatus: async () => { throw new Error("live read-only agent attempted GitHub mutation"); },
};

(live ? it : it.skip)("uses a real AI SDK 7 ToolLoopAgent to read real Git and DataHub evidence", async () => {
  const repoRoot = productEnv(process.env, "AGENT_REPOSITORY_ROOT");
  const baseRef = productEnv(process.env, "AGENT_BASE_REF");
  const headRef = productEnv(process.env, "AGENT_HEAD_REF");
  if (!repoRoot || !baseRef || !headRef) throw new Error("live agent Git scope is incomplete");
  const client = await DataHubMcpClient.connect(dataHubMcpConfigFromEnv());
  try {
    const evidence = { collect: async (change: Parameters<typeof collectEvidence>[1], maxHops: number) =>
      await collectEvidence(client, change, maxHops) };
    const service = new CasesService(evidence, new DataHubCaseStore(client));
    const scope = {
      repoRoot,
      repository: "change-marshal/live-demo-typescript",
      baseRef,
      headRef,
      targetUrl: "https://example.invalid/change-marshal/read-only-proof",
      maxHops: 3,
      ownerMappings: [],
      validationCommand: [],
      artifactPaths: [],
    };
    const operations = createAgentOperations({
      scope, evidence, service,
      workSurface: forbiddenWorkSurface,
      statusSurface: forbiddenWorkSurface,
    });
    const agent = createChangeMarshalAgent({
      model: coordinationModel(aiConfigFromEnv()),
      scope,
      operations,
    });

    const result = await agent.generate({
      prompt: "Call inspectDataHubImpact exactly once. Do not call a mutating tool. Then summarize the exact change, source URN, and downstream ML asset from its returned evidence.",
      options: {
        governedCaseKey: "0".repeat(24),
        requiredToolSequence: ["inspectDataHubImpact"],
      },
    });

    expect(result.toolCalls.map((call) => call.toolName)).toContain("inspectDataHubImpact");
    expect(result.content.some((part) => part.type === "tool-approval-request")).toBe(false);
    expect(result.text).toContain("customers");

  } finally {
    await client.close();
  }
}, 5 * 60_000);
