import { createQvac, models, type ManagedQvacProvider } from "@qvac/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import type { QvacRuntimeConfig } from "../config";

const managedModelNames: Readonly<Record<string, string>> = {
  "qwen3.5-4b": models.QWEN3_5_4B_MULTIMODAL_Q4_K_M.name,
  "qwen3.6-27b": models.QWEN3_6_27B_MULTIMODAL_Q4_K_XL.name,
  "qwen3.6-35b-a3b": models.QWEN3_6_35B_A3B_MULTIMODAL_Q4_K_M.name,
};

export class QvacRuntimeError extends Error {
  override readonly name = "QvacRuntimeError";
}

export interface QvacModelHandle {
  readonly model: LanguageModel;
  readonly modelId: string;
  readonly baseUrl: string;
  readonly managed: boolean;
  close(): Promise<void>;
}

export function resolveQvacServeBin(): string {
  return fileURLToPath(new URL("../../scripts/qvac-serve.mjs", import.meta.url));
}

export function managedQvacTempDir(platform: NodeJS.Platform, inherited: string): string {
  return platform === "darwin" && Buffer.byteLength(inherited) > 48 ? "/private/tmp" : inherited;
}

export async function waitForQvacModel(input: Readonly<{
  baseUrl: string;
  modelName: string;
  timeoutMs: number;
  pollMs?: number;
  fetchImpl?: typeof fetch;
}>): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const deadline = Date.now() + input.timeoutMs;
  const pollMs = input.pollMs ?? 2_000;
  do {
    try {
      const response = await fetchImpl(`${input.baseUrl}/models`);
      if (response.ok) {
        const body = await response.json() as { data?: readonly { id?: unknown }[] };
        if (body.data?.some(({ id }) => id === input.modelName)) return;
      }
    } catch {
      // The managed process can restart while loading; readiness remains false.
    }
    if (Date.now() >= deadline) break;
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  } while (true);
  throw new QvacRuntimeError(`QVAC model ${input.modelName} did not become ready within ${input.timeoutMs}ms`);
}

export async function createQvacModel(config: QvacRuntimeConfig): Promise<QvacModelHandle> {
  if (config.mode === "external") {
    if (config.baseUrl === undefined) throw new QvacRuntimeError("external QVAC mode requires a base URL");
    const provider = createQvac({ baseURL: config.baseUrl, apiKey: config.apiKey ?? "qvac" });
    return {
      model: provider(config.model),
      modelId: config.model,
      baseUrl: config.baseUrl,
      managed: false,
      close: async () => undefined,
    };
  }

  const managedName = managedModelNames[config.model] ?? config.model;
  let provider: ManagedQvacProvider | undefined;
  const previousTempDir = process.env.TMPDIR;
  process.env.TMPDIR = managedQvacTempDir(process.platform, previousTempDir ?? tmpdir());
  try {
    provider = await createQvac({
      mode: "managed",
      models: [{
        name: managedName,
        preload: true,
        default: true,
        config: {
          ctx_size: config.contextSize,
          reasoning_budget: config.reasoningBudget,
          tools: true,
        },
      }],
      serveStartTimeout: 30 * 60_000,
      serveIdleTimeout: 10 * 60_000,
      serveBinPath: resolveQvacServeBin(),
    });
    await waitForQvacModel({
      baseUrl: provider.baseURL,
      modelName: managedName,
      timeoutMs: 30 * 60_000,
    });
  } catch (error) {
    if (provider !== undefined) await provider.close().catch(() => undefined);
    throw new QvacRuntimeError(`could not start managed QVAC model ${config.model}`, { cause: error });
  } finally {
    if (previousTempDir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTempDir;
  }
  if (provider === undefined) throw new QvacRuntimeError(`managed QVAC model ${config.model} has no provider`);
  return {
    model: provider(managedName),
    modelId: config.model,
    baseUrl: provider.baseURL,
    managed: true,
    close: async () => await provider.close(),
  };
}
