import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { DataHubToolCaller } from "./evidence";

const evidenceTools = [
  "search",
  "get_entities",
  "list_schema_fields",
  "get_lineage",
  "get_lineage_paths_between",
  "get_dataset_queries",
] as const;

const dataHubToolTimeoutMs = 120_000;

export type DataHubMcpConfig =
  | Readonly<{
      kind: "stdio";
      command: string;
      args?: readonly string[];
      env?: Readonly<Record<string, string>>;
      cwd?: string;
    }>
  | Readonly<{
      kind: "http";
      url: string;
      headers?: Readonly<Record<string, string>>;
    }>;

export class DataHubMcpError extends Error {
  override readonly name = "DataHubMcpError";
}

function decodeResult(result: Readonly<Record<string, unknown>>, name: string): unknown {
  if (result.isError === true) throw new DataHubMcpError(`DataHub MCP tool failed: ${name}`);
  if (result.structuredContent !== undefined) {
    const structured = result.structuredContent;
    if (
      typeof structured === "object"
      && structured !== null
      && !Array.isArray(structured)
      && Object.keys(structured).length === 1
      && "result" in structured
    ) {
      return (structured as Readonly<Record<string, unknown>>).result;
    }
    return structured;
  }
  if (!Array.isArray(result.content) || result.content.length !== 1) {
    throw new DataHubMcpError(`DataHub MCP tool returned no unambiguous result: ${name}`);
  }
  const item = result.content[0] as Readonly<Record<string, unknown>>;
  if (item.type !== "text" || typeof item.text !== "string") {
    throw new DataHubMcpError(`DataHub MCP tool returned unsupported content: ${name}`);
  }
  try {
    return JSON.parse(item.text) as unknown;
  } catch (error) {
    throw new DataHubMcpError(`DataHub MCP tool returned invalid JSON: ${name}`, { cause: error });
  }
}

export class DataHubMcpClient implements DataHubToolCaller {
  private constructor(
    private readonly client: Client,
    private readonly availableTools: ReadonlySet<string>,
  ) {}

  static async connect(config: DataHubMcpConfig): Promise<DataHubMcpClient> {
    const client = new Client({ name: "cutset", version: "0.2.0" });
    try {
      if (config.kind === "stdio") {
        if (!config.command.trim()) throw new DataHubMcpError("MCP command must be non-empty");
        const transport = new StdioClientTransport({
          command: config.command,
          ...(config.args === undefined ? {} : { args: [...config.args] }),
          ...(config.env === undefined ? {} : { env: { ...getDefaultEnvironment(), ...config.env } }),
          ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
          stderr: "pipe",
        });
        await client.connect(transport as Transport);
      } else {
        const url = new URL(config.url);
        if (!config.url.startsWith("https://") && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
          throw new DataHubMcpError("remote MCP HTTP transport must use HTTPS");
        }
        const transport = new StreamableHTTPClientTransport(url, {
          ...(config.headers === undefined
            ? {}
            : { requestInit: { headers: { ...config.headers } } }),
        });
        await client.connect(transport as Transport);
      }
      const listed = await client.listTools();
      const available = new Set(listed.tools.map((tool) => tool.name));
      const missing = evidenceTools.filter((name) => !available.has(name));
      if (missing.length > 0) {
        throw new DataHubMcpError(`DataHub MCP server is missing required tools: ${missing.join(", ")}`);
      }
      return new DataHubMcpClient(client, available);
    } catch (error) {
      await client.close().catch(() => undefined);
      if (error instanceof DataHubMcpError) throw error;
      throw new DataHubMcpError("could not connect to DataHub MCP server", { cause: error });
    }
  }

  async callTool(name: string, input: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (!this.availableTools.has(name)) {
      throw new DataHubMcpError(`required DataHub MCP tool is unavailable: ${name}`);
    }
    try {
      const result = await this.client.callTool(
        { name, arguments: { ...input } },
        undefined,
        { timeout: dataHubToolTimeoutMs, maxTotalTimeout: dataHubToolTimeoutMs },
      );
      return decodeResult(result, name);
    } catch (error) {
      if (error instanceof DataHubMcpError) throw error;
      throw new DataHubMcpError(`DataHub MCP operation failed: ${name}`, { cause: error });
    }
  }

  supportsTool(name: string): boolean {
    return this.availableTools.has(name);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
