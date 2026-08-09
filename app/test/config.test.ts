import { describe, expect, it } from "vitest";

import { ConfigError, dataHubMcpConfigFromEnv, githubConfigFromEnv, parseCommand } from "../src/config";

describe("runtime configuration", () => {
  it("builds explicit real MCP HTTP and stdio configurations", () => {
    expect(dataHubMcpConfigFromEnv({
      CUTSET_DATAHUB_MCP_URL: "https://datahub.example/mcp",
      CUTSET_DATAHUB_MCP_TOKEN: "secret",
    })).toEqual({ kind: "http", url: "https://datahub.example/mcp", headers: { Authorization: "Bearer secret" } });
    expect(dataHubMcpConfigFromEnv({
      CUTSET_DATAHUB_MCP_COMMAND: "npx",
      CUTSET_DATAHUB_MCP_ARGS: '["-y","@acryldata/mcp-server-datahub"]',
      DATAHUB_GMS_URL: "http://localhost:8080",
      TOOLS_IS_MUTATION_ENABLED: "true",
    })).toEqual({
      kind: "stdio", command: "npx", args: ["-y", "@acryldata/mcp-server-datahub"],
      env: { DATAHUB_GMS_URL: "http://localhost:8080", TOOLS_IS_MUTATION_ENABLED: "true" },
    });
  });

  it("fails closed without explicit integrations or malformed commands", () => {
    expect(() => dataHubMcpConfigFromEnv({})).toThrow(ConfigError);
    expect(() => githubConfigFromEnv({})).toThrow(/GitHub/i);
    expect(() => parseCommand("echo unsafe")).toThrow(/JSON/i);
    expect(parseCommand('["npm","test"]')).toEqual(["npm", "test"]);
  });
});
