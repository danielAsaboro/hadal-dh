import { createQvac, models, type ManagedQvacProvider } from "@qvac/ai-sdk-provider";
import type { LanguageModel } from "ai";

import type { QvacRuntimeConfig } from "../config";

const managedModelNames: Readonly<Record<string, string>> = {
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
  let provider: ManagedQvacProvider;
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
    });
  } catch (error) {
    throw new QvacRuntimeError(`could not start managed QVAC model ${config.model}`, { cause: error });
  }
  return {
    model: provider(managedName),
    modelId: config.model,
    baseUrl: provider.baseURL,
    managed: true,
    close: async () => await provider.close(),
  };
}
