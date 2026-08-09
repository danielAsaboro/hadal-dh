import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import { AGENT_TOOL_APPROVAL, MUTATING_AGENT_TOOLS, createChangeMarshalAgent, type AgentOperations } from "../../src/ai/orchestrator";
import { coordinationModel } from "../../src/ai/coordination-brief";

describe("ChangeMarshal AI SDK 7 ToolLoopAgent", () => {
  it("exposes the complete deterministic workflow and approval-gates every mutation", () => {
    const agent = createChangeMarshalAgent({
      model: coordinationModel({ baseUrl: "https://models.example/v1", apiKey: "secret", model: "model" }),
      scope: {
        repoRoot: "/real/repository",
        repository: "owner/change-marshal",
        baseRef: "base",
        headRef: "head",
        targetUrl: "https://example.com/cases/current",
        maxHops: 3,
        ownerMappings: [],
        validationCommand: ["npm", "test"],
        artifactPaths: [".changemarshal/remediation/customers_compatibility.sql"],
      },
      operations: {
        inspectGitChange: async () => ({ kind: "dbt_column_rename" as const }),
        inspectDataHubImpact: async () => ({ complete: true }),
        planChangeCase: async () => ({ caseKey: "a".repeat(24) }),
        readCase: async () => ({ caseKey: "a".repeat(24) }),
        mapOwners: async () => ({ caseKey: "a".repeat(24) }),
        syncGitHubWork: async () => ({ caseKey: "a".repeat(24) }),
        generateRemediation: async () => ({ written: [] }),
        validateWork: async () => ({ caseKey: "a".repeat(24) }),
        reconcileGitHubWork: async () => ({ caseKey: "a".repeat(24) }),
        publishMergeDecision: async () => ({ allowed: false, blockers: ["APPROVAL_MISSING"] }),
      },
    });

    expect(Object.keys(agent.tools)).toEqual([
      "inspectGitChange", "inspectDataHubImpact", "planChangeCase", "readCase",
      "mapOwners", "syncGitHubWork", "generateRemediation", "validateWork",
      "reconcileGitHubWork", "publishMergeDecision",
    ]);
    expect(MUTATING_AGENT_TOOLS).toEqual([
      "planChangeCase", "mapOwners", "syncGitHubWork", "generateRemediation",
      "validateWork", "reconcileGitHubWork", "publishMergeDecision",
    ]);
    expect(AGENT_TOOL_APPROVAL).toEqual(Object.fromEntries(
      MUTATING_AGENT_TOOLS.map((name) => [name, "user-approval"]),
    ));
  });

  it("returns an AI SDK approval request without executing a proposed mutation", async () => {
    let executed = false;
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "tool-call", toolCallId: "call-1", toolName: "planChangeCase", input: "{}" }],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    const operations: AgentOperations = {
      inspectGitChange: async () => ({}), inspectDataHubImpact: async () => ({}),
      planChangeCase: async () => { executed = true; return {}; }, readCase: async () => ({}),
      mapOwners: async () => ({}), syncGitHubWork: async () => ({}), generateRemediation: async () => ({}),
      validateWork: async () => ({}), reconcileGitHubWork: async () => ({}), publishMergeDecision: async () => ({}),
    };
    const agent = createChangeMarshalAgent({
      model,
      scope: {
        repoRoot: "/real/repository", repository: "owner/change-marshal", baseRef: "base", headRef: "head",
        targetUrl: "https://example.com/cases/current", maxHops: 3, ownerMappings: [],
        validationCommand: ["npm", "test"], artifactPaths: [".changemarshal/remediation/a.sql"],
      },
      operations,
    });

    const result = await agent.generate({ prompt: "Plan the governed case." });

    expect(executed).toBe(false);
    expect(result.content.some((part) => part.type === "tool-approval-request")).toBe(true);
  });
});
