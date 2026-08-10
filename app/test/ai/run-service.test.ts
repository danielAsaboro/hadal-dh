import { describe, expect, it } from "vitest";

import { AgentRunCoordinator } from "../../src/ai/run-coordinator";
import { GovernedAgentRunService, type AgentGenerator } from "../../src/ai/run-service";

const caseKey = "1".repeat(24);
const headSha = "a".repeat(40);

function coordinator() {
  let sequence = 0;
  return new AgentRunCoordinator({
    now: () => new Date("2026-08-09T15:00:00.000Z"),
    id: (prefix) => `${prefix}-${++sequence}`,
  });
}

describe("real agent approval continuation service", () => {
  it("pauses on the exact AI SDK approval request and resumes with an approval response", async () => {
    const calls: Parameters<AgentGenerator["generate"]>[0][] = [];
    const generator: AgentGenerator = {
      generate: async (options) => {
        calls.push(options);
        if (calls.length === 1) {
          return {
            text: "",
            content: [{
              type: "tool-approval-request",
              approvalId: "approval-sdk-1",
              toolCall: { type: "tool-call", toolCallId: "call-sdk-1", toolName: "generateRemediation", input: { caseKey } },
            }],
            response: { messages: [{ role: "assistant", content: "approval requested" }] },
          };
        }
        return {
          text: "The approved remediation was generated and verified by its tool result.",
          content: [],
          response: { messages: [{ role: "assistant", content: "done" }] },
        };
      },
    };
    const service = new GovernedAgentRunService({ coordinator: coordinator(), generator, modelId: "qwen3.6-27b", managed: true });

    const waiting = await service.start({ caseKey, headSha, prompt: "Generate only the governed remediation." });
    expect(waiting.status).toBe("waiting_for_approval");
    expect(waiting.pendingApproval).toMatchObject({ approvalId: "approval-sdk-1", toolCallId: "call-sdk-1" });

    const completed = await service.resolveApproval({
      runId: waiting.runId,
      token: waiting.pendingApproval?.token ?? "",
      currentHeadSha: headSha,
      approved: true,
      reason: "operator reviewed exact arguments",
    });
    expect(completed.status).toBe("completed");
    expect(completed.answer).toContain("approved remediation");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages?.at(-1)).toEqual({
      role: "tool",
      content: [{ type: "tool-approval-response", approvalId: "approval-sdk-1", approved: true, reason: "operator reviewed exact arguments" }],
    });
  });

  it("fails closed when a model returns multiple simultaneous mutation approvals", async () => {
    const request = (approvalId: string, toolCallId: string) => ({
      type: "tool-approval-request",
      approvalId,
      toolCall: { type: "tool-call", toolCallId, toolName: "syncGitHubWork", input: { caseKey } },
    });
    const service = new GovernedAgentRunService({
      coordinator: coordinator(), modelId: "qwen3.6-27b", managed: true,
      generator: { generate: async () => ({
        text: "", content: [request("approval-1", "call-1"), request("approval-2", "call-2")],
        response: { messages: [] },
      }) },
    });

    const failed = await service.start({ caseKey, headSha, prompt: "Coordinate work." });
    expect(failed.status).toBe("failed");
    expect(failed.events.at(-1)?.summary).toMatch(/one mutation approval/i);
  });
});
