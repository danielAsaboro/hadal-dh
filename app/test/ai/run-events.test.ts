import { describe, expect, it } from "vitest";

import { AgentRunEventSchema, AgentRunSnapshotSchema, toDurableAgentRun } from "../../src/ai/run-events";

describe("agent run evidence schemas", () => {
  it("rejects events without a monotonic sequence or exact timestamp", () => {
    expect(() => AgentRunEventSchema.parse({
      kind: "run_started", sequence: 0, at: "not-a-date", summary: "started",
    })).toThrow();
  });

  it("rejects snapshots with raw secrets in the typed surface", () => {
    expect(() => AgentRunSnapshotSchema.parse({
      runId: "run-1",
      caseKey: "1".repeat(24),
      headSha: "a".repeat(40),
      modelId: "qwen3.6-27b",
      status: "running",
      events: [],
      apiKey: "must-not-be-accepted",
    })).toThrow();
  });

  it("projects a live approval snapshot into a token-free durable run", () => {
    const snapshot = AgentRunSnapshotSchema.parse({
      runId: "run-1",
      caseKey: "1".repeat(24),
      headSha: "a".repeat(40),
      modelId: "qwen3.6-27b",
      status: "waiting_for_approval",
      events: [
        { kind: "run_started", sequence: 1, at: "2026-08-10T01:00:00.000Z", summary: "started" },
        { kind: "approval_required", sequence: 2, at: "2026-08-10T01:01:00.000Z", summary: "approval", argumentsHash: "b".repeat(64) },
      ],
      pendingApproval: {
        token: "single-use-secret",
        approvalId: "approval-1",
        toolCallId: "call-1",
        toolName: "generateRemediation",
        argumentsHash: "b".repeat(64),
        requestedAt: "2026-08-10T01:01:00.000Z",
        expiresAt: "2026-08-10T01:16:00.000Z",
      },
    });

    const durable = toDurableAgentRun(snapshot, "c".repeat(24));

    expect(durable).toMatchObject({
      runId: "run-1",
      revisionKey: "c".repeat(24),
      createdAt: "2026-08-10T01:00:00.000Z",
      updatedAt: "2026-08-10T01:01:00.000Z",
      pendingApproval: { approvalId: "approval-1", toolName: "generateRemediation" },
    });
    expect(durable.pendingApproval).not.toHaveProperty("token");
  });
});
