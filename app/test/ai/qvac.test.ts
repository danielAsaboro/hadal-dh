import { describe, expect, it } from "vitest";

import { createQvacModel } from "../../src/ai/qvac";

describe("official QVAC AI SDK provider", () => {
  it("creates an external provider handle with an explicit model identity", async () => {
    const handle = await createQvacModel({
      mode: "external",
      baseUrl: "http://127.0.0.1:11435/v1",
      apiKey: "local-only",
      model: "qwen3.6-27b",
      contextSize: 32768,
      reasoningBudget: 0,
    });

    expect(handle.modelId).toBe("qwen3.6-27b");
    expect(handle.baseUrl).toBe("http://127.0.0.1:11435/v1");
    expect(handle.managed).toBe(false);
    expect(typeof handle.model).toBe("object");
    await expect(handle.close()).resolves.toBeUndefined();
  });
});
