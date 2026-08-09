import { describe, expect, it } from "vitest";

import { aiConfigFromEnv, ConfigError, dataHubMcpConfigFromEnv, githubConfigFromEnv, parseCommand, warnLegacyProductEnv } from "../src/config";

describe("runtime configuration", () => {
  it("builds explicit real MCP HTTP and stdio configurations", () => {
    expect(dataHubMcpConfigFromEnv({
      CHANGEMARSHAL_DATAHUB_MCP_URL: "https://datahub.example/mcp",
      CHANGEMARSHAL_DATAHUB_MCP_TOKEN: "secret",
    })).toEqual({ kind: "http", url: "https://datahub.example/mcp", headers: { Authorization: "Bearer secret" } });
    expect(dataHubMcpConfigFromEnv({
      CHANGEMARSHAL_DATAHUB_MCP_COMMAND: "npx",
      CHANGEMARSHAL_DATAHUB_MCP_ARGS: '["-y","@acryldata/mcp-server-datahub"]',
      DATAHUB_GMS_URL: "http://localhost:8080",
      TOOLS_IS_MUTATION_ENABLED: "true",
      DATA_QUALITY_TOOLS_ENABLED: "true",
    })).toEqual({
      kind: "stdio", command: "npx", args: ["-y", "@acryldata/mcp-server-datahub"],
      env: {
        DATAHUB_GMS_URL: "http://localhost:8080",
        TOOLS_IS_MUTATION_ENABLED: "true",
        DATA_QUALITY_TOOLS_ENABLED: "true",
      },
    });
  });

  it("reads legacy CUTSET variables but fails closed on cross-brand conflicts", () => {
    expect(githubConfigFromEnv({
      CUTSET_GITHUB_TOKEN: "legacy-token",
      CUTSET_GITHUB_REPOSITORY: "acme/warehouse",
      CUTSET_GITHUB_PULL_NUMBER: "7",
    })).toEqual({ token: "legacy-token", repository: "acme/warehouse", pullNumber: 7 });

    expect(() => githubConfigFromEnv({
      CHANGEMARSHAL_GITHUB_TOKEN: "new-token",
      CUTSET_GITHUB_TOKEN: "old-token",
      CHANGEMARSHAL_GITHUB_REPOSITORY: "acme/warehouse",
      CUTSET_GITHUB_REPOSITORY: "acme/warehouse",
      CHANGEMARSHAL_GITHUB_PULL_NUMBER: "7",
      CUTSET_GITHUB_PULL_NUMBER: "7",
    })).toThrow(/conflicting.*GITHUB_TOKEN/i);

    expect(githubConfigFromEnv({
      CHANGEMARSHAL_GITHUB_TOKEN: "same",
      CUTSET_GITHUB_TOKEN: "same",
      CHANGEMARSHAL_GITHUB_REPOSITORY: "acme/warehouse",
      CUTSET_GITHUB_REPOSITORY: "acme/warehouse",
      CHANGEMARSHAL_GITHUB_PULL_NUMBER: "7",
      CUTSET_GITHUB_PULL_NUMBER: "7",
    })).toEqual({ token: "same", repository: "acme/warehouse", pullNumber: 7 });
  });

  it("fails closed without explicit integrations or malformed commands", () => {
    expect(() => dataHubMcpConfigFromEnv({})).toThrow(ConfigError);
    expect(() => githubConfigFromEnv({})).toThrow(/GitHub/i);
    expect(() => parseCommand("echo unsafe")).toThrow(/JSON/i);
    expect(parseCommand('["npm","test"]')).toEqual(["npm", "test"]);
  });

  it("requires an explicit real AI SDK 7 model endpoint", () => {
    expect(aiConfigFromEnv({
      CHANGEMARSHAL_AI_BASE_URL: "https://models.example/v1",
      CHANGEMARSHAL_AI_API_KEY: "real-secret",
      CHANGEMARSHAL_AI_MODEL: "governed-model",
    })).toEqual({ baseUrl: "https://models.example/v1", apiKey: "real-secret", model: "governed-model" });
    expect(() => aiConfigFromEnv({ CHANGEMARSHAL_AI_MODEL: "missing-transport" })).toThrow(/AI_BASE_URL/i);
  });

  it("emits one actionable warning for legacy environment variables", () => {
    const messages: string[] = [];
    warnLegacyProductEnv({
      CUTSET_GITHUB_TOKEN: "legacy",
      CUTSET_GITHUB_REPOSITORY: "acme/warehouse",
      CHANGEMARSHAL_GITHUB_PULL_NUMBER: "7",
    }, (message) => messages.push(message));

    expect(messages).toEqual([
      "ChangeMarshal accepted legacy environment variables CUTSET_GITHUB_REPOSITORY, CUTSET_GITHUB_TOKEN; migrate them to the CHANGEMARSHAL_ prefix.\n",
    ]);
  });
});
