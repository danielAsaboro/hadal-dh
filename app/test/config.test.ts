import { describe, expect, it } from "vitest";

import { agentScopeFromEnv, aiConfigFromEnv, ConfigError, dataHubMcpConfigFromEnv, githubConfigFromEnv, parseCommand, qvacConfigFromEnv, warnLegacyProductEnv } from "../src/config";

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

  it("defaults QVAC to the managed local model proven by the live flow", () => {
    expect(qvacConfigFromEnv({})).toEqual({
      mode: "managed",
      model: "qwen3.6-27b",
      contextSize: 16384,
      reasoningBudget: 0,
    });
  });

  it("requires an explicit endpoint for an externally managed QVAC server", () => {
    expect(qvacConfigFromEnv({
      CHANGEMARSHAL_QVAC_MODE: "external",
      CHANGEMARSHAL_QVAC_BASE_URL: "http://127.0.0.1:11435/v1",
      CHANGEMARSHAL_QVAC_MODEL: "qwen3.6-35b-a3b",
      CHANGEMARSHAL_QVAC_API_KEY: "local-only",
    })).toEqual({
      mode: "external",
      baseUrl: "http://127.0.0.1:11435/v1",
      apiKey: "local-only",
      model: "qwen3.6-35b-a3b",
      contextSize: 16384,
      reasoningBudget: 0,
    });
    expect(() => qvacConfigFromEnv({ CHANGEMARSHAL_QVAC_MODE: "external" })).toThrow(/QVAC_BASE_URL/i);
  });

  it("builds a fixed fail-closed web agent scope from explicit environment values", () => {
    expect(agentScopeFromEnv("/real/repository", {
      CHANGEMARSHAL_AGENT_REPOSITORY: "acme/warehouse",
      CHANGEMARSHAL_AGENT_BASE_REF: "main",
      CHANGEMARSHAL_AGENT_HEAD_REF: "HEAD",
      CHANGEMARSHAL_AGENT_TARGET_URL: "http://127.0.0.1:4100/",
      CHANGEMARSHAL_AGENT_OWNER_MAPPINGS_JSON: '[["urn:li:corpuser:owner","owner-gh"]]',
      CHANGEMARSHAL_AGENT_VALIDATION_COMMAND_JSON: '["npm","test"]',
      CHANGEMARSHAL_AGENT_ARTIFACT_PATHS_JSON: '["models/customers.sql"]',
      CHANGEMARSHAL_AGENT_MAX_HOPS: "4",
    })).toEqual({
      repoRoot: "/real/repository", repository: "acme/warehouse", baseRef: "main", headRef: "HEAD",
      targetUrl: "http://127.0.0.1:4100/", maxHops: 4,
      ownerMappings: [["urn:li:corpuser:owner", "owner-gh"]],
      validationCommand: ["npm", "test"], artifactPaths: ["models/customers.sql"],
    });
    expect(() => agentScopeFromEnv("/real/repository", {})).toThrow(/AGENT_REPOSITORY/i);
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
