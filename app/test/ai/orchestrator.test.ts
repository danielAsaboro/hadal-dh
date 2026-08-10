import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";

import { AGENT_TIMEOUT, AGENT_TOOL_APPROVAL, MUTATING_AGENT_TOOLS, createChangeMarshalAgent, type AgentOperations } from "../../src/ai/orchestrator";
import { coordinationModel } from "../../src/ai/coordination-brief";

describe("ChangeMarshal AI SDK 7 ToolLoopAgent", () => {
  const governedCaseKey = "a".repeat(24);
  const defaultCallOptions = { governedCaseKey, requiredToolSequence: ["readCase"] as const };

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
      defaultCallOptions,
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
    expect(AGENT_TIMEOUT).toEqual({ totalMs: 5 * 60_000, stepMs: 150_000, toolMs: 2 * 60_000 });
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
      defaultCallOptions: { governedCaseKey, requiredToolSequence: ["planChangeCase"] },
    });

    const result = await agent.generate({ prompt: "Plan the governed case.", options: {} });

    expect(executed).toBe(false);
    expect(result.content.some((part) => part.type === "tool-approval-request")).toBe(true);
  });

  it("forces an operator-selected tool sequence while leaving mutation execution approval-gated", async () => {
    const choices: unknown[] = [];
    const outputBudgets: unknown[] = [];
    let calls = 0;
    let mutationExecuted = false;
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        choices.push(options.toolChoice);
        outputBudgets.push(options.maxOutputTokens);
        calls += 1;
        const read = calls === 1;
        return {
          content: [{
            type: "tool-call" as const,
            toolCallId: `call-${calls}`,
            toolName: read ? "readCase" : "generateRemediation",
            input: JSON.stringify({ caseKey: "a".repeat(24) }),
          }],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    const operations: AgentOperations = {
      inspectGitChange: async () => ({}), inspectDataHubImpact: async () => ({}), planChangeCase: async () => ({}),
      readCase: async () => ({ caseKey: "a".repeat(24) }), mapOwners: async () => ({}), syncGitHubWork: async () => ({}),
      generateRemediation: async () => { mutationExecuted = true; return {}; }, validateWork: async () => ({}),
      reconcileGitHubWork: async () => ({}), publishMergeDecision: async () => ({}),
    };
    const agent = createChangeMarshalAgent({
      model,
      scope: {
        repoRoot: "/real/repository", repository: "owner/change-marshal", baseRef: "base", headRef: "head",
        targetUrl: "https://example.com/cases/current", maxHops: 3, ownerMappings: [],
        validationCommand: ["npm", "test"], artifactPaths: [".changemarshal/remediation/a.sql"],
      },
      operations,
      defaultCallOptions,
    });

    const result = await agent.generate({
      prompt: "Read the case, then propose remediation.",
      options: { governedCaseKey, requiredToolSequence: ["readCase", "generateRemediation"] },
    });

    expect(choices).toEqual([
      { type: "tool", toolName: "readCase" },
      { type: "tool", toolName: "generateRemediation" },
    ]);
    expect(outputBudgets).toEqual([512, 512]);
    expect(mutationExecuted).toBe(false);
    expect(result.content.some((part) => part.type === "tool-approval-request")).toBe(true);
  });

  it("rejects a call that omits a deterministic plan and has no configured default", async () => {
    const agent = createChangeMarshalAgent({
      model: coordinationModel({ baseUrl: "https://models.example/v1", apiKey: "secret", model: "model" }),
      scope: {
        repoRoot: "/real/repository", repository: "owner/change-marshal", baseRef: "base", headRef: "head",
        targetUrl: "https://example.com/cases/current", maxHops: 3, ownerMappings: [],
        validationCommand: ["npm", "test"], artifactPaths: [".changemarshal/remediation/a.sql"],
      },
      operations: {
        inspectGitChange: async () => ({}), inspectDataHubImpact: async () => ({}), planChangeCase: async () => ({}),
        readCase: async () => ({}), mapOwners: async () => ({}), syncGitHubWork: async () => ({}),
        generateRemediation: async () => ({}), validateWork: async () => ({}), reconcileGitHubWork: async () => ({}),
        publishMergeDecision: async () => ({}),
      },
    });

    await expect(agent.generate({ prompt: "Do something.", options: {} }))
      .rejects.toThrow(/governed case key and deterministic tool sequence are required/i);
  });

  it("rejects a tool argument for any case other than the run-bound case", async () => {
    let read = false;
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{
          type: "tool-call", toolCallId: "call-wrong", toolName: "readCase",
          input: JSON.stringify({ caseKey: "b".repeat(24) }),
        }],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    const agent = createChangeMarshalAgent({
      model,
      scope: {
        repoRoot: "/real/repository", repository: "owner/change-marshal", baseRef: "base", headRef: "head",
        targetUrl: "https://example.com/cases/current", maxHops: 3, ownerMappings: [],
        validationCommand: ["npm", "test"], artifactPaths: [".changemarshal/remediation/a.sql"],
      },
      operations: {
        inspectGitChange: async () => ({}), inspectDataHubImpact: async () => ({}), planChangeCase: async () => ({}),
        readCase: async () => { read = true; return {}; }, mapOwners: async () => ({}), syncGitHubWork: async () => ({}),
        generateRemediation: async () => ({}), validateWork: async () => ({}), reconcileGitHubWork: async () => ({}),
        publishMergeDecision: async () => ({}),
      },
      defaultCallOptions,
    });

    const result = await agent.generate({ prompt: "Read the governed case.", options: {} });
    expect(read).toBe(false);
    expect(result.content.some((part) =>
      part.type === "tool-error"
      && part.error instanceof Error
      && /does not match the governed run case/i.test(part.error.message),
    )).toBe(true);
  });
});
