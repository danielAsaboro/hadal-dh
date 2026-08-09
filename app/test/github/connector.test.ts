import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ChangeCase, ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import { GitHubApi } from "../../src/github/api";
import { GitHubConnector, GitHubConnectorError } from "../../src/github/connector";
import { workMarker } from "../../src/github/markers";

type Issue = {
  number: number;
  title: string;
  body: string;
  state: string;
  assignee: { login: string };
  html_url: string;
};

class GitHubContractServer {
  readonly issues = new Map<number, Issue>();
  readonly mutations: string[] = [];
  readonly eligible = new Set(["producer-gh", "consumer-gh"]);
  headSha = "head";
  actor = "producer-gh";
  permission = "write";
  status: Record<string, unknown> | undefined;
  private nextIssue = 1;
  private readonly server = createServer((request, response) => void this.route(request, response));
  url = "";

  async start(): Promise<void> {
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    const address = this.server.address();
    if (typeof address === "string" || address === null) throw new Error("missing address");
    this.url = `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    this.server.close();
    await once(this.server, "close");
  }

  addIssue(body: string, assignee = "producer-gh"): void {
    const number = this.nextIssue++;
    this.issues.set(number, {
      number, title: "duplicate", body, state: "open", assignee: { login: assignee },
      html_url: `https://github.com/acme/warehouse/issues/${number}`,
    });
  }

  private json(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  }

  private async body(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    expect(request.headers.authorization).toBe("Bearer test-token");
    expect(request.headers["x-github-api-version"]).toBe("2022-11-28");
    const url = new URL(request.url ?? "/", this.url);
    const method = request.method ?? "GET";
    if (method === "GET" && url.pathname === "/repos/acme/warehouse") {
      return this.json(response, 200, { full_name: "acme/warehouse", private: false });
    }
    if (method === "GET" && url.pathname === "/repos/acme/warehouse/pulls/7") {
      return this.json(response, 200, { number: 7, head: { sha: this.headSha }, html_url: "https://github.com/acme/warehouse/pull/7" });
    }
    const assignee = /^\/repos\/acme\/warehouse\/assignees\/([^/]+)$/.exec(url.pathname)?.[1];
    if (method === "GET" && assignee) {
      response.writeHead(this.eligible.has(assignee) ? 204 : 404);
      response.end();
      return;
    }
    if (method === "GET" && url.pathname === "/repos/acme/warehouse/issues") {
      return this.json(response, 200, [...this.issues.values()]);
    }
    if (method === "POST" && url.pathname === "/repos/acme/warehouse/issues") {
      this.mutations.push("create");
      const input = await this.body(request);
      const number = this.nextIssue++;
      const issue: Issue = {
        number,
        title: String(input.title),
        body: String(input.body),
        state: "open",
        assignee: { login: (input.assignees as string[])[0] as string },
        html_url: `https://github.com/acme/warehouse/issues/${number}`,
      };
      this.issues.set(number, issue);
      return this.json(response, 201, issue);
    }
    const issueNumber = /^\/repos\/acme\/warehouse\/issues\/(\d+)$/.exec(url.pathname)?.[1];
    if (issueNumber && method === "PATCH") {
      this.mutations.push("update");
      const input = await this.body(request);
      const current = this.issues.get(Number(issueNumber));
      if (!current) return this.json(response, 404, { message: "Not Found" });
      const updated = {
        ...current,
        title: String(input.title), body: String(input.body), state: String(input.state),
        assignee: { login: (input.assignees as string[])[0] as string },
      };
      this.issues.set(Number(issueNumber), updated);
      return this.json(response, 200, updated);
    }
    if (issueNumber && method === "GET") {
      const issue = this.issues.get(Number(issueNumber));
      return issue ? this.json(response, 200, issue) : this.json(response, 404, { message: "Not Found" });
    }
    if (method === "GET" && url.pathname === "/user") {
      return this.json(response, 200, { login: this.actor, id: 100 });
    }
    if (method === "GET" && url.pathname === `/repos/acme/warehouse/collaborators/${this.actor}/permission`) {
      return this.json(response, 200, { permission: this.permission, user: { login: this.actor } });
    }
    if (method === "POST" && url.pathname === "/repos/acme/warehouse/statuses/head") {
      this.mutations.push("status");
      this.status = await this.body(request);
      return this.json(response, 201, { ...this.status, id: 99 });
    }
    if (method === "GET" && url.pathname === "/repos/acme/warehouse/commits/head/status") {
      return this.json(response, 200, { state: this.status?.state ?? "pending", sha: "head", statuses: this.status ? [this.status] : [] });
    }
    return this.json(response, 404, { message: `unhandled ${method} ${url.pathname}` });
  }
}

function plannedCase(): ChangeCase {
  const source = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
  const consumer = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.orders,PROD)";
  const asset = (urn: string, name: string, owner: string) => ({
    urn, type: "dataset", name, owners: [owner], tags: [], glossaryTerms: [],
    incidentStatuses: [], assertions: [], queries: [], complete: true,
  });
  const evidence: ImpactEvidence = {
    complete: true,
    source: { urn: source, type: "dataset", name: "customers" },
    schemaFields: ["email"],
    paths: [{ sourceUrn: source, downstreamUrn: consumer, column: "email", downstreamColumns: ["email"], nodes: [source, consumer] }],
    assets: [asset(source, "customers", "urn:li:corpuser:producer"), asset(consumer, "orders", "urn:li:corpuser:consumer")],
  };
  const value = compileCase(evidence, {
    repository: "acme/warehouse", baseSha: "base", headSha: "head",
    observedAt: "2026-08-09T10:00:00.000Z",
    change: { kind: "dbt_column_rename", modelName: "customers", oldName: "email", newName: "email_address", sourcePath: "models/schema.yml" },
  });
  return {
    ...value,
    ownerMappings: [
      ["urn:li:corpuser:producer", "producer-gh"],
      ["urn:li:corpuser:consumer", "consumer-gh"],
    ],
  };
}

describe("real GitHub contract connector", () => {
  let service: GitHubContractServer;
  let connector: GitHubConnector;

  beforeEach(async () => {
    service = new GitHubContractServer();
    await service.start();
    connector = new GitHubConnector(new GitHubApi({ token: "test-token", baseUrl: service.url }), "acme/warehouse", 7);
  });

  afterEach(async () => service.close());

  it("creates and rereads exact work, then updates without duplication", async () => {
    const value = plannedCase();
    const first = await connector.syncWork(value, "2026-08-09T10:05:00.000Z");
    const second = await connector.syncWork({ ...value, externalProjections: first }, "2026-08-09T10:10:00.000Z");

    expect(first).toHaveLength(value.workItems.length);
    expect(first.every((projection) => projection.state === "verified")).toBe(true);
    expect(service.issues.size).toBe(value.workItems.length);
    expect(service.mutations.filter((item) => item === "create")).toHaveLength(value.workItems.length);
    expect(service.mutations.filter((item) => item === "update")).toHaveLength(value.workItems.length);
    expect(second.map(({ workKey }) => workKey).sort()).toEqual(value.workItems.map(({ workKey }) => workKey).sort());
  });

  it("performs all head, mapping, and assignee checks before mutation", async () => {
    service.headSha = "other";
    await expect(connector.syncWork(plannedCase(), "2026-08-09T10:05:00.000Z"))
      .rejects.toThrow(/head SHA/i);
    expect(service.mutations).toEqual([]);

    service.headSha = "head";
    service.eligible.delete("consumer-gh");
    await expect(connector.syncWork(plannedCase(), "2026-08-09T10:05:00.000Z"))
      .rejects.toThrow(/eligible assignee/i);
    expect(service.mutations).toEqual([]);
  });

  it("rejects duplicate work markers before mutation", async () => {
    const value = plannedCase();
    const marker = workMarker(value.workItems[0]?.workKey as string);
    service.addIssue(marker);
    service.addIssue(marker);

    await expect(connector.syncWork(value, "2026-08-09T10:05:00.000Z"))
      .rejects.toThrow(/duplicate/i);
    expect(service.mutations).toEqual([]);
  });

  it("verifies the token actor and publishes then rereads admission status", async () => {
    await expect(connector.verifyActor("producer-gh")).resolves.toEqual({ login: "producer-gh", permission: "write" });
    await connector.publishAndVerifyStatus("head", false, "https://cutset.example/cases/one");

    expect(service.status).toMatchObject({
      state: "failure",
      context: "cutset/governed-change",
      target_url: "https://cutset.example/cases/one",
    });

    service.permission = "read";
    await expect(connector.verifyActor("producer-gh")).rejects.toBeInstanceOf(GitHubConnectorError);
  });
});
