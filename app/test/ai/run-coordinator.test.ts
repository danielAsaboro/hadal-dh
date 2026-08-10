import { describe, expect, it } from "vitest";

import { AgentRunCoordinator, AgentRunError } from "../../src/ai/run-coordinator";

const headSha = "a".repeat(40);

function coordinator() {
  let token = 0;
  return new AgentRunCoordinator({
    now: () => new Date("2026-08-09T14:00:00.000Z"),
    id: (prefix) => `${prefix}-${++token}`,
  });
}

describe("governed agent run coordination", () => {
  it("records an immutable model-bound run without retaining the prompt", () => {
    const value = coordinator().start({
      caseKey: "1".repeat(24),
      headSha,
      modelId: "qwen3.6-27b",
      prompt: "private operator request",
    });

    expect(value.status).toBe("running");
    expect(value.modelId).toBe("qwen3.6-27b");
    expect(value.events.map((event) => event.kind)).toEqual(["run_started", "model_connected"]);
    expect(JSON.stringify(value)).not.toContain("private operator request");
  });

  it("binds single-use mutation approval to exact arguments and Git head", () => {
    const runs = coordinator();
    const started = runs.start({ caseKey: "2".repeat(24), headSha, modelId: "qwen3.6-27b", prompt: "coordinate" });
    const pending = runs.requireApproval(started.runId, {
      approvalId: "approval-real-1",
      toolCallId: "call-real-1",
      toolName: "syncGitHubWork",
      input: { caseKey: "2".repeat(24) },
    });
    expect(pending.status).toBe("waiting_for_approval");
    expect(pending.pendingApproval?.argumentsHash).toMatch(/^[a-f0-9]{64}$/);

    expect(() => runs.resolveApproval(started.runId, pending.pendingApproval?.token ?? "", "b".repeat(40), true))
      .toThrow(/Git head/i);
    const denied = runs.resolveApproval(started.runId, pending.pendingApproval?.token ?? "", headSha, false, "operator denied");
    expect(denied.status).toBe("running");
    expect(denied.events.at(-1)).toMatchObject({ kind: "tool_denied", approved: false });
    expect(() => runs.resolveApproval(started.runId, pending.pendingApproval?.token ?? "", headSha, true))
      .toThrow(/already used/i);
  });

  it("rejects approval requests for read-only or unknown tools", () => {
    const runs = coordinator();
    const started = runs.start({ caseKey: "3".repeat(24), headSha, modelId: "qwen3.6-27b", prompt: "coordinate" });
    expect(() => runs.requireApproval(started.runId, {
      approvalId: "approval-bad",
      toolCallId: "call-bad",
      toolName: "inspectGitChange",
      input: {},
    })).toThrow(AgentRunError);
  });

  it("records tool execution and terminal state without persisting tool payloads", () => {
    const runs = coordinator();
    const started = runs.start({ caseKey: "4".repeat(24), headSha, modelId: "qwen3.6-27b", prompt: "coordinate" });

    runs.toolProposed(started.runId, { toolName: "inspectGitChange", toolCallId: "call-read-1" });
    runs.toolStarted(started.runId, { toolName: "inspectGitChange", toolCallId: "call-read-1" });
    runs.toolCompleted(started.runId, { toolName: "inspectGitChange", toolCallId: "call-read-1" });
    const completed = runs.complete(started.runId, "Grounded coordination answer emitted");

    expect(completed.status).toBe("completed");
    expect(completed.answer).toBe("Grounded coordination answer emitted");
    expect(completed.events.map((event) => event.kind)).toEqual([
      "run_started", "model_connected", "tool_proposed", "tool_started", "tool_completed",
      "answer_emitted", "run_completed",
    ]);
    expect(JSON.stringify(completed)).not.toContain("customers.secret_payload");
    expect(() => runs.toolStarted(started.runId, { toolName: "inspectDataHubImpact", toolCallId: "late" }))
      .toThrow(/terminal/i);
  });

  it("records a fail-closed terminal error", () => {
    const runs = coordinator();
    const started = runs.start({ caseKey: "5".repeat(24), headSha, modelId: "qwen3.6-27b", prompt: "coordinate" });
    const failed = runs.fail(started.runId, "DataHub evidence unavailable");
    expect(failed.status).toBe("failed");
    expect(failed.events.at(-1)).toMatchObject({ kind: "run_failed", summary: "DataHub evidence unavailable" });
  });
});
