import type { DataHubMcpConfig } from "./datahub/mcp-client";

type Environment = Readonly<Record<string, string | undefined>>;

export type QvacRuntimeConfig = Readonly<{
  mode: "managed" | "external";
  model: string;
  contextSize: number;
  reasoningBudget: number;
  baseUrl?: string;
  apiKey?: string;
}>;

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export function productEnv(env: Environment, suffix: string): string | undefined {
  const canonicalName = `CHANGEMARSHAL_${suffix}`;
  const legacyName = `CUTSET_${suffix}`;
  const canonical = env[canonicalName];
  const legacy = env[legacyName];
  if (canonical !== undefined && legacy !== undefined && canonical !== legacy) {
    throw new ConfigError(`conflicting ${canonicalName} and legacy ${legacyName}`);
  }
  return canonical ?? legacy;
}

export function warnLegacyProductEnv(
  env: Environment = process.env,
  write: (message: string) => void = (message) => process.stderr.write(message),
): void {
  const names = Object.keys(env)
    .filter((name) => name.startsWith("CUTSET_") && env[name] !== undefined)
    .sort();
  if (names.length > 0) {
    write(`ChangeMarshal accepted legacy environment variables ${names.join(", ")}; migrate them to the CHANGEMARSHAL_ prefix.\n`);
  }
}

function jsonStringArray(value: string | undefined, label: string): readonly string[] {
  if (value === undefined) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((part) => typeof part === "string" && part.length > 0)) {
      throw new Error("not a non-empty string array");
    }
    return parsed;
  } catch (error) {
    throw new ConfigError(`${label} must be a JSON array of non-empty strings`, { cause: error });
  }
}

export function dataHubMcpConfigFromEnv(env: Environment = process.env): DataHubMcpConfig {
  const url = productEnv(env, "DATAHUB_MCP_URL");
  const command = productEnv(env, "DATAHUB_MCP_COMMAND");
  if (url && command) throw new ConfigError("configure exactly one DataHub MCP transport");
  if (url) {
    const token = productEnv(env, "DATAHUB_MCP_TOKEN");
    return {
      kind: "http",
      url,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    };
  }
  if (!command) throw new ConfigError("CHANGEMARSHAL_DATAHUB_MCP_URL or CHANGEMARSHAL_DATAHUB_MCP_COMMAND is required (legacy CUTSET_ aliases are accepted)");
  const names = [
    "DATAHUB_GMS_URL",
    "DATAHUB_GMS_TOKEN",
    "TOOLS_IS_MUTATION_ENABLED",
    "DATA_QUALITY_TOOLS_ENABLED",
    "SAVE_DOCUMENT_TOOL_ENABLED",
    "SAVE_DOCUMENT_RESTRICT_UPDATES",
    "SAVE_DOCUMENT_PARENT_TITLE",
    "DATAHUB_MCP_DOCUMENT_TOOLS_DISABLED",
  ];
  const childEnv = Object.fromEntries(names.flatMap((name) =>
    env[name] === undefined ? [] : [[name, env[name] as string]]));
  return {
    kind: "stdio",
    command,
    args: jsonStringArray(productEnv(env, "DATAHUB_MCP_ARGS"), "CHANGEMARSHAL_DATAHUB_MCP_ARGS"),
    env: childEnv,
  };
}

export function githubConfigFromEnv(env: Environment = process.env): Readonly<{
  token: string;
  repository: string;
  pullNumber: number;
}> {
  const token = productEnv(env, "GITHUB_TOKEN");
  const repository = productEnv(env, "GITHUB_REPOSITORY");
  const pullNumber = Number(productEnv(env, "GITHUB_PULL_NUMBER"));
  if (!token || !repository || !Number.isInteger(pullNumber) || pullNumber < 1) {
    throw new ConfigError("CHANGEMARSHAL_GITHUB_TOKEN, CHANGEMARSHAL_GITHUB_REPOSITORY, and a positive CHANGEMARSHAL_GITHUB_PULL_NUMBER are required (legacy CUTSET_ aliases are accepted)");
  }
  return { token, repository, pullNumber };
}

export function aiConfigFromEnv(env: Environment = process.env): Readonly<{
  baseUrl: string;
  apiKey: string;
  model: string;
}> {
  const baseUrl = productEnv(env, "AI_BASE_URL");
  const apiKey = productEnv(env, "AI_API_KEY");
  const model = productEnv(env, "AI_MODEL");
  if (!baseUrl || !apiKey || !model) {
    throw new ConfigError("CHANGEMARSHAL_AI_BASE_URL, CHANGEMARSHAL_AI_API_KEY, and CHANGEMARSHAL_AI_MODEL are required for the AI SDK 7 brief");
  }
  return { baseUrl, apiKey, model };
}

function integerEnv(value: string | undefined, fallback: number, label: string, minimum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new ConfigError(`${label} must be an integer greater than or equal to ${minimum}`);
  return parsed;
}

export function qvacConfigFromEnv(env: Environment = process.env): QvacRuntimeConfig {
  const mode = productEnv(env, "QVAC_MODE") ?? "managed";
  if (mode !== "managed" && mode !== "external") throw new ConfigError("CHANGEMARSHAL_QVAC_MODE must be managed or external");
  const model = productEnv(env, "QVAC_MODEL") ?? "qwen3.6-27b";
  const contextSize = integerEnv(productEnv(env, "QVAC_CONTEXT_SIZE"), 32768, "CHANGEMARSHAL_QVAC_CONTEXT_SIZE", 1024);
  const reasoningBudget = integerEnv(productEnv(env, "QVAC_REASONING_BUDGET"), 0, "CHANGEMARSHAL_QVAC_REASONING_BUDGET", -1);
  if (mode === "managed") return { mode, model, contextSize, reasoningBudget };
  const baseUrl = productEnv(env, "QVAC_BASE_URL");
  if (!baseUrl) throw new ConfigError("CHANGEMARSHAL_QVAC_BASE_URL is required in external QVAC mode");
  return {
    mode,
    baseUrl,
    apiKey: productEnv(env, "QVAC_API_KEY") ?? "qvac",
    model,
    contextSize,
    reasoningBudget,
  };
}

export function parseCommand(value: string): readonly string[] {
  return jsonStringArray(value, "validation command");
}
