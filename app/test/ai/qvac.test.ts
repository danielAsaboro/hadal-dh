import { describe, expect, it } from "vitest";

import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";

import { createQvacModel, managedQvacTempDir, resolveQvacServeBin, waitForQvacModel } from "../../src/ai/qvac";

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

  it("resolves the explicitly installed QVAC CLI for managed mode", async () => {
    const executable = resolveQvacServeBin();
    expect(executable).toMatch(/scripts\/qvac-serve\.mjs$/);
    await expect(access(executable, constants.X_OK)).resolves.toBeUndefined();
    const source = await readFile(executable, "utf8");
    expect(source).toContain('import("@qvac/cli")');
    expect(source).toContain('new URL("../qvac.config.json"');
  });

  it("does not report managed readiness until the exact model is listed", async () => {
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify({
        object: "list",
        data: requests === 1 ? [] : [{ id: "QWEN3_6_27B_MULTIMODAL_Q4_K_XL", object: "model" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    await expect(waitForQvacModel({
      baseUrl: "http://127.0.0.1:11435/v1",
      modelName: "QWEN3_6_27B_MULTIMODAL_Q4_K_XL",
      timeoutMs: 100,
      pollMs: 0,
      fetchImpl,
    })).resolves.toBeUndefined();
    expect(requests).toBe(2);
  });

  it("uses a short macOS temp path when the inherited path cannot hold a worker socket", () => {
    expect(managedQvacTempDir("darwin", "/var/folders/an/extremely/long/application/container/temporary/path")).toBe("/private/tmp");
    expect(managedQvacTempDir("linux", "/tmp")).toBe("/tmp");
  });

  it("ships retry and stall limits suitable for a real multi-gigabyte registry artifact", async () => {
    const config = JSON.parse(await readFile(new URL("../../qvac.config.json", import.meta.url), "utf8")) as Record<string, unknown>;
    expect(config.registryStreamTimeoutMs).toBe(600_000);
    expect(config.registryDownloadMaxRetries).toBe(8);
  });
});
