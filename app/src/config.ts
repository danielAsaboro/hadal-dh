import type { DataHubMcpConfig } from "./datahub/mcp-client";

type Environment = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  override readonly name = "ConfigError";
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
  const url = env.CUTSET_DATAHUB_MCP_URL;
  const command = env.CUTSET_DATAHUB_MCP_COMMAND;
  if (url && command) throw new ConfigError("configure exactly one DataHub MCP transport");
  if (url) {
    const token = env.CUTSET_DATAHUB_MCP_TOKEN;
    return {
      kind: "http",
      url,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    };
  }
  if (!command) throw new ConfigError("CUTSET_DATAHUB_MCP_URL or CUTSET_DATAHUB_MCP_COMMAND is required");
  const names = [
    "DATAHUB_GMS_URL",
    "DATAHUB_GMS_TOKEN",
    "TOOLS_IS_MUTATION_ENABLED",
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
    args: jsonStringArray(env.CUTSET_DATAHUB_MCP_ARGS, "CUTSET_DATAHUB_MCP_ARGS"),
    env: childEnv,
  };
}

export function githubConfigFromEnv(env: Environment = process.env): Readonly<{
  token: string;
  repository: string;
  pullNumber: number;
}> {
  const token = env.CUTSET_GITHUB_TOKEN;
  const repository = env.CUTSET_GITHUB_REPOSITORY;
  const pullNumber = Number(env.CUTSET_GITHUB_PULL_NUMBER);
  if (!token || !repository || !Number.isInteger(pullNumber) || pullNumber < 1) {
    throw new ConfigError("CUTSET_GITHUB_TOKEN, CUTSET_GITHUB_REPOSITORY, and a positive CUTSET_GITHUB_PULL_NUMBER are required");
  }
  return { token, repository, pullNumber };
}

export function parseCommand(value: string): readonly string[] {
  return jsonStringArray(value, "validation command");
}
