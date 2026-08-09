import { describe, expect, it } from "vitest";

import { AgentRunEventSchema, AgentRunSnapshotSchema } from "../../src/ai/run-events";

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
});
