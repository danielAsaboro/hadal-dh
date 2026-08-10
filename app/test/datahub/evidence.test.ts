import { describe, expect, it } from "vitest";

import type { DbtColumnRename } from "../../src/domain/case";
import {
  collectEvidence,
  DataHubEvidenceError,
  type DataHubToolCaller,
} from "../../src/datahub/evidence";

const sourceUrn =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
const consumerUrn =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customer_orders,PROD)";
const modelUrn = "urn:li:mlModel:customer_churn";
const change: DbtColumnRename = {
  kind: "dbt_column_rename",
  modelName: "customers",
  oldName: "email",
  newName: "email_address",
  sourcePath: "models/customers.yml",
};

type Reply = unknown | ((input: Readonly<Record<string, unknown>>) => unknown);

class CapturedToolResults implements DataHubToolCaller {
  readonly calls: Array<readonly [string, Readonly<Record<string, unknown>>]> = [];

  constructor(private readonly replies: Readonly<Record<string, readonly Reply[]>>) {}

  async callTool(name: string, input: Readonly<Record<string, unknown>>): Promise<unknown> {
    this.calls.push([name, input]);
    const queue = this.replies[name];
    const reply = queue?.[this.calls.filter(([called]) => called === name).length - 1];
    if (reply === undefined) throw new Error(`unexpected tool call: ${name}`);
    return typeof reply === "function" ? reply(input) : reply;
  }
}

function entity(
  urn: string,
  type: string,
  name: string,
  owner: string,
  extra: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    urn,
    type,
    properties: { name },
    ownership: { owners: [{ owner: { urn: owner, name: owner } }] },
    tags: { tags: [{ tag: { urn: "urn:li:tag:PII", name: "PII" } }] },
    glossaryTerms: {
      terms: [{ term: { urn: "urn:li:glossaryTerm:Customer", name: "Customer" } }],
    },
    health: [],
    ...extra,
  };
}

function assertionPage(
  assertions: readonly Readonly<Record<string, unknown>>[],
  total = assertions.length,
) {
  return {
    success: true,
    data: { start: 0, count: assertions.length, total, assertions },
  };
}

function completeReplies(): Readonly<Record<string, readonly Reply[]>> {
  const source = entity(
    sourceUrn,
    "dataset",
    "analytics.customers",
    "urn:li:corpuser:producer",
  );
  const consumer = entity(
    consumerUrn,
    "dataset",
    "analytics.customer_orders",
    "urn:li:corpuser:orders_owner",
    { health: [{ type: "INCIDENTS", status: "WARN" }] },
  );
  const model = entity(
    modelUrn,
    "mlModel",
    "customer_churn",
    "urn:li:corpuser:ml_owner",
  );
  const job = entity(
    "urn:li:dataJob:(urn:li:dataFlow:(airflow,cutset-demo,PROD),train-churn)",
    "dataJob",
    "train-churn",
    "urn:li:corpuser:ml_owner",
  );
  const assertion = {
    urn: "urn:li:assertion:email-not-null",
    type: "FIELD",
    column: "email",
    latestResultType: "SUCCESS",
  };

  return {
    search: [
      {
        start: 0,
        count: 1,
        total: 1,
        searchResults: [{ entity: source }],
      },
    ],
    get_entities: [[source], [source, consumer, model]],
    list_schema_fields: [
      {
        totalFields: 2,
        returned: 2,
        remainingCount: 0,
        offset: 0,
        fields: [{ fieldPath: "customer_id" }, { fieldPath: "email" }],
      },
    ],
    get_lineage: [
      {
        downstreams: {
          start: 0,
          count: 2,
          offset: 0,
          returned: 2,
          total: 2,
          hasMore: false,
          searchResults: [
            { entity: consumer, degree: "1", lineageColumns: ["customer_email"] },
            { entity: model, degree: "2", lineageColumns: [] },
          ],
        },
      },
      {
        downstreams: {
          start: 0,
          count: 3,
          offset: 0,
          returned: 3,
          total: 3,
          hasMore: false,
          searchResults: [
            { entity: consumer, degree: "1", lineageColumns: [] },
            { entity: job, degree: "2", lineageColumns: [] },
            { entity: model, degree: "2", lineageColumns: [] },
          ],
        },
      },
    ],
    get_lineage_paths_between: [
      {
        metadata: { direction: "downstream" },
        target: { urn: consumerUrn },
        pathCount: 1,
        paths: [{ path: [source, consumer] }],
      },
      {
        metadata: { direction: "downstream" },
        target: { urn: modelUrn },
        pathCount: 1,
        paths: [{ path: [source, consumer, model] }],
      },
    ],
    get_dataset_queries: [
      {
        start: 0,
        count: 10,
        total: 1,
        queries: [
          {
            urn: "urn:li:query:source-query",
            properties: {
              source: "SYSTEM",
              name: "customer lookup",
              statement: {
                language: "SQL",
                value: "select email from customers where customer_id = 42 and email = 'private@example.com'",
              },
            },
            subjects: [{ urn: sourceUrn }],
          },
        ],
      },
      { start: 0, count: 10, total: 0, queries: [] },
    ],
    get_dataset_assertions: [
      assertionPage([assertion]),
      assertionPage([], 0),
      assertionPage([], 0),
      assertionPage([], 0),
      assertionPage([], 0),
      assertionPage([], 0),
    ],
  };
}

describe("DataHub evidence collection", () => {
  it("records unavailable optional assertion capability without inventing assertions", async () => {
    const replies = completeReplies();
    const tools = new CapturedToolResults(replies) as CapturedToolResults & { supportsTool(name: string): boolean };
    tools.supportsTool = (name: string) => name !== "get_dataset_assertions";
    const evidence = await collectEvidence(tools, change);
    expect(evidence.capabilities).toEqual({ datasetAssertions: false });
    expect(evidence.assets.every((asset) => asset.assertions.length === 0)).toBe(true);
  });

  it("collects exact governed evidence and removes query literals", async () => {
    const tools = new CapturedToolResults(completeReplies());

    const evidence = await collectEvidence(tools, change, 3);

    expect(evidence.complete).toBe(true);
    expect(evidence.source.urn).toBe(sourceUrn);
    expect(evidence.schemaFields).toEqual(["customer_id", "email"]);
    expect(evidence.paths).toHaveLength(2);
    expect(evidence.paths[0]?.nodes).toEqual([sourceUrn, consumerUrn]);
    expect(evidence.assets.map(({ urn, type }) => [urn, type])).toEqual([
      [sourceUrn, "dataset"],
      [consumerUrn, "dataset"],
      [modelUrn, "mlModel"],
    ]);
    expect(evidence.assets[1]?.incidentStatuses).toEqual(["WARN"]);
    expect(evidence.assets[0]?.assertions[0]?.status).toBe("SUCCESS");
    const statement = evidence.assets[0]?.queries[0]?.statement ?? "";
    expect(statement).not.toContain("private@example.com");
    expect(statement).not.toContain("42");
    expect(statement).toContain("?");
    expect(tools.calls.find(([name]) => name === "get_lineage")?.[1]).toEqual({
      urn: sourceUrn,
      column: "email",
      upstream: false,
      max_hops: 3,
      max_results: 50,
      offset: 0,
    });
    expect(tools.calls.filter(([name]) => name === "get_lineage")[1]?.[1]).toEqual({
      urn: sourceUrn,
      upstream: false,
      max_hops: 3,
      max_results: 50,
      offset: 0,
    });
  });

  it("accepts verified column-level paths whose endpoints are schema-field URNs", async () => {
    const replies = { ...completeReplies() } as Record<string, readonly Reply[]>;
    const paths = [...(replies.get_lineage_paths_between ?? [])];
    paths[0] = {
      metadata: { direction: "downstream" },
      target: { urn: consumerUrn },
      pathCount: 1,
      paths: [{ path: [
        entity(`urn:li:schemaField:(${sourceUrn},email)`, "schemaField", "email", "urn:li:corpuser:producer"),
        entity(`urn:li:schemaField:(${consumerUrn},customer_email)`, "schemaField", "customer_email", "urn:li:corpuser:orders_owner"),
      ] }],
    };
    replies.get_lineage_paths_between = paths;
    const evidence = await collectEvidence(new CapturedToolResults(replies), change);
    expect(evidence.paths[0]?.nodes).toEqual([
      `urn:li:schemaField:(${sourceUrn},email)`,
      `urn:li:schemaField:(${consumerUrn},customer_email)`,
    ]);
  });

  it("normalizes the official MCP omission of an empty queries array", async () => {
    const replies = { ...completeReplies() } as Record<string, readonly Reply[]>;
    replies.get_dataset_queries = [
      { start: 0, count: 10, total: 0 },
      { start: 0, count: 10, total: 0 },
    ];
    const evidence = await collectEvidence(new CapturedToolResults(replies), change);
    expect(evidence.assets.filter((asset) => asset.type === "dataset").every((asset) => asset.queries.length === 0)).toBe(true);
  });

  it("reads every bounded search page before resolving an exact dataset", async () => {
    const replies = { ...completeReplies() } as Record<string, readonly Reply[]>;
    const source = (replies.search?.[0] as { searchResults: readonly unknown[] }).searchResults[0];
    const unrelated = Array.from({ length: 10 }, (_, index) => ({
      entity: entity(
        `urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customer_${index},PROD)`,
        "dataset",
        `analytics.customer_${index}`,
        "urn:li:corpuser:other",
      ),
    }));
    replies.search = [
      { start: 0, count: 10, total: 11, searchResults: [source, ...unrelated.slice(0, 9)] },
      { start: 10, count: 10, total: 11, searchResults: unrelated.slice(9) },
    ];
    const tools = new CapturedToolResults(replies);

    const evidence = await collectEvidence(tools, change, 3);

    expect(evidence.source.urn).toBe(sourceUrn);
    expect(tools.calls.filter(([name]) => name === "search").map(([, input]) => input.offset))
      .toEqual([0, 10]);
  });

  it("rejects ambiguous exact-name resolution", async () => {
    const replies = completeReplies();
    const source = (replies.search?.[0] as Record<string, unknown>);
    const duplicate = entity(
      "urn:li:dataset:(urn:li:dataPlatform:bigquery,analytics.customers,PROD)",
      "dataset",
      "analytics.customers",
      "urn:li:corpuser:other",
    );
    const tools = new CapturedToolResults({
      ...replies,
      search: [{ ...source, count: 2, total: 2, searchResults: [
        ...((source.searchResults as readonly unknown[]) ?? []),
        { entity: duplicate },
      ] }],
    });

    await expect(collectEvidence(tools, change, 3)).rejects.toThrow(
      /exactly one DataHub dataset/i,
    );
  });

  it.each([
    ["search pagination", (replies: Record<string, readonly Reply[]>) => {
      replies.search = [{ ...(replies.search?.[0] as object), total: 2 }];
    }],
    ["schema pagination", (replies: Record<string, readonly Reply[]>) => {
      replies.list_schema_fields = [{
        ...(replies.list_schema_fields?.[0] as object),
        remainingCount: 1,
      }];
    }],
    ["lineage pagination", (replies: Record<string, readonly Reply[]>) => {
      const result = replies.get_lineage?.[0] as { downstreams: object };
      replies.get_lineage = [{
        downstreams: { ...result.downstreams, hasMore: true },
      }];
    }],
    ["missing exact path", (replies: Record<string, readonly Reply[]>) => {
      replies.get_lineage_paths_between = [{
        metadata: { direction: "downstream" }, target: { urn: consumerUrn },
        pathCount: 0, paths: [],
      }];
    }],
    ["missing entity", (replies: Record<string, readonly Reply[]>) => {
      replies.get_entities = [[]];
    }],
  ])("fails closed on incomplete %s", async (_label, mutate) => {
    const replies = { ...completeReplies() } as Record<string, readonly Reply[]>;
    mutate(replies);

    await expect(collectEvidence(new CapturedToolResults(replies), change, 3))
      .rejects.toBeInstanceOf(DataHubEvidenceError);
  });

  it("rejects an absent source column and out-of-policy hop bounds", async () => {
    const replies = { ...completeReplies() } as Record<string, readonly Reply[]>;
    replies.list_schema_fields = [{
      totalFields: 1,
      returned: 1,
      remainingCount: 0,
      offset: 0,
      fields: [{ fieldPath: "customer_id" }],
    }];

    await expect(collectEvidence(new CapturedToolResults(replies), change, 3))
      .rejects.toThrow(/does not contain column email/i);
    await expect(collectEvidence(new CapturedToolResults(completeReplies()), change, 4))
      .rejects.toThrow(/maxHops/i);
  });
});
