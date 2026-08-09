import {
  ImpactEvidenceSchema,
  type DbtColumnRename,
  type ImpactEvidence,
} from "../domain/case";
import {
  DataHubNormalizationError,
  array,
  displayName,
  entityType,
  integer,
  logicalDatasetName,
  nestedUrns,
  record,
  redactSql,
  text,
  urn,
  type JsonRecord,
} from "./normalize";

export interface DataHubToolCaller {
  callTool(name: string, input: Readonly<Record<string, unknown>>): Promise<unknown>;
  supportsTool?(name: string): boolean;
}

export class DataHubEvidenceError extends Error {
  override readonly name = "DataHubEvidenceError";
}

type Asset = Readonly<{ urn: string; type: string; name: string }>;
type SummaryPath = Readonly<{
  downstream: Asset;
  downstreamColumns: readonly string[];
}>;

function pathEndpointMatches(nodeUrn: string, assetUrn: string, column?: string): boolean {
  if (nodeUrn === assetUrn) return true;
  if (column === undefined) return nodeUrn.startsWith(`urn:li:schemaField:(${assetUrn},`);
  return nodeUrn === `urn:li:schemaField:(${assetUrn},${column})`;
}

function asEvidenceError(error: unknown): DataHubEvidenceError {
  if (error instanceof DataHubEvidenceError) return error;
  const message = error instanceof Error ? error.message : "unknown DataHub response error";
  return new DataHubEvidenceError(message, { cause: error });
}

function assetFromEntity(value: unknown): Asset {
  const entity = record(value, "entity");
  return {
    urn: urn(entity.urn, "entity"),
    type: entityType(entity),
    name: displayName(entity),
  };
}

async function resolveSource(
  tools: DataHubToolCaller,
  modelName: string,
): Promise<Asset> {
  const response = record(await tools.callTool("search", {
    query: `/q ${modelName}`,
    filter: "entity_type = dataset",
    num_results: 10,
    offset: 0,
  }), "search response");
  const results = array(response.searchResults, "search results");
  const total = integer(response.total, "search total");
  const start = response.start === undefined ? 0 : integer(response.start, "search start");
  if (start !== 0 || total !== results.length) {
    throw new DataHubEvidenceError("DataHub asset search results are incomplete");
  }
  const candidates = new Map<string, Asset>();
  for (const result of results) {
    const entity = record(record(result, "search result").entity, "search entity");
    const asset = assetFromEntity(entity);
    if (asset.type === "dataset" && logicalDatasetName(entity) === modelName.toLowerCase()) {
      candidates.set(asset.urn, asset);
    }
  }
  if (candidates.size !== 1) {
    throw new DataHubEvidenceError(`expected exactly one DataHub dataset for model ${modelName}`);
  }
  return [...candidates.values()][0] as Asset;
}

function normalizeLineage(response: unknown): readonly SummaryPath[] {
  const payload = record(response, "get_lineage response");
  const downstreams = record(payload.downstreams, "downstream lineage");
  const results = array(downstreams.searchResults, "lineage results");
  const returned = integer(downstreams.returned, "lineage returned");
  const total = integer(downstreams.total, "lineage total");
  const offset = integer(downstreams.offset, "lineage offset");
  if (
    offset !== 0
    || returned !== results.length
    || total !== returned
    || downstreams.hasMore !== false
    || downstreams.truncatedDueToTokenBudget === true
  ) {
    throw new DataHubEvidenceError("DataHub lineage response is incomplete");
  }
  return results.map((result) => {
    const item = record(result, "lineage result");
    const columns = array(item.lineageColumns ?? [], "lineage columns").map((column) =>
      text(column, "lineage column"));
    return { downstream: assetFromEntity(item.entity), downstreamColumns: columns };
  });
}

async function exactPaths(
  tools: DataHubToolCaller,
  source: Asset,
  oldColumn: string,
  summaries: readonly SummaryPath[],
): Promise<ImpactEvidence["paths"]> {
  const normalized: Array<ImpactEvidence["paths"][number]> = [];
  for (const summary of summaries) {
    const targetColumns: readonly (string | undefined)[] = summary.downstreamColumns.length > 0
      ? summary.downstreamColumns
      : [undefined];
    for (const targetColumn of targetColumns) {
      const input: Record<string, unknown> = {
        source_urn: source.urn,
        target_urn: summary.downstream.urn,
        direction: "downstream",
      };
      if (targetColumn !== undefined) {
        input.source_column = oldColumn;
        input.target_column = targetColumn;
      }
      const payload = record(
        await tools.callTool("get_lineage_paths_between", input),
        "exact lineage response",
      );
      const metadata = record(payload.metadata, "lineage metadata");
      const target = record(payload.target, "lineage target");
      const paths = array(payload.paths, "exact lineage paths");
      const count = integer(payload.pathCount, "exact lineage path count");
      if (
        metadata.direction !== "downstream"
        || target.urn !== summary.downstream.urn
        || count !== paths.length
        || count < 1
      ) {
        throw new DataHubEvidenceError("exact lineage path response is incomplete");
      }
      for (const pathValue of paths) {
        const nodes = array(record(pathValue, "lineage path").path, "lineage path nodes")
          .map((node) => assetFromEntity(node).urn);
        if (
          !pathEndpointMatches(nodes[0] as string, source.urn, targetColumn === undefined ? undefined : oldColumn)
          || !pathEndpointMatches(nodes.at(-1) as string, summary.downstream.urn, targetColumn)
        ) {
          throw new DataHubEvidenceError(
            `exact lineage path endpoints do not match the request: expected ${source.urn} -> ${summary.downstream.urn}, received ${nodes.join(" -> ")}`,
          );
        }
        normalized.push({
          sourceUrn: source.urn,
          downstreamUrn: summary.downstream.urn,
          column: oldColumn,
          downstreamColumns: targetColumn === undefined ? [] : [targetColumn],
          nodes,
        });
      }
    }
  }
  return normalized;
}

function normalizeQueries(datasetUrn: string, response: unknown): ImpactEvidence["assets"][number]["queries"] {
  const payload = record(response, "dataset queries response");
  const start = integer(payload.start, "query start");
  const total = integer(payload.total, "query total");
  const count = integer(payload.count, "query count");
  const queries = payload.queries === undefined && total === 0
    ? []
    : array(payload.queries, "queries");
  if (start !== 0 || queries.length > count || queries.length !== total) {
    throw new DataHubEvidenceError("dataset query response is incomplete");
  }
  return queries.map((value) => {
    const query = record(value, "query");
    const properties = record(query.properties, "query properties");
    const statement = record(properties.statement, "query statement");
    const subjects = array(query.subjects ?? [], "query subjects").map((subject) =>
      typeof subject === "string"
        ? urn(subject, "query subject")
        : urn(record(subject, "query subject").urn, "query subject"));
    if (!subjects.includes(datasetUrn)) {
      throw new DataHubEvidenceError("query subjects omitted the requested dataset");
    }
    if (statement.language !== "SQL" || !["MANUAL", "SYSTEM"].includes(String(properties.source))) {
      throw new DataHubEvidenceError("query language or source is unsupported");
    }
    return {
      urn: urn(query.urn, "query"),
      source: text(properties.source, "query source"),
      language: text(statement.language, "query language"),
      name: properties.name === null || properties.name === undefined
        ? null
        : text(properties.name, "query name"),
      statement: redactSql(text(statement.value, "query SQL")),
      subjects: [...new Set(subjects)].sort(),
    };
  }).sort((left, right) => left.urn.localeCompare(right.urn));
}

function assertionPage(response: unknown, label: string): readonly JsonRecord[] {
  const payload = record(response, label);
  if (payload.success !== true) throw new DataHubEvidenceError(`${label} did not succeed`);
  const data = record(payload.data, `${label} data`);
  const assertions = array(data.assertions, `${label} assertions`).map((value) => record(value, "assertion"));
  if (
    integer(data.start, `${label} start`) !== 0
    || integer(data.count, `${label} count`) !== assertions.length
    || integer(data.total, `${label} total`) < assertions.length
  ) {
    throw new DataHubEvidenceError(`${label} pagination is invalid`);
  }
  return assertions;
}

async function normalizeAssertions(
  tools: DataHubToolCaller,
  datasetUrn: string,
  column: string | undefined,
): Promise<ImpactEvidence["assets"][number]["assertions"]> {
  if (tools.supportsTool?.("get_dataset_assertions") === false) return [];
  const base: Record<string, unknown> = {
    urn: datasetUrn,
    start: 0,
    count: 5,
    run_events_count: 1,
  };
  if (column !== undefined) base.column = column;
  const sampleResponse = await tools.callTool("get_dataset_assertions", base);
  const failingResponse = await tools.callTool("get_dataset_assertions", { ...base, count: 1, status: "FAILING" });
  const errorResponse = await tools.callTool("get_dataset_assertions", { ...base, count: 1, status: "ERROR" });
  const sample = assertionPage(sampleResponse, "assertion sample");
  assertionPage(failingResponse, "failing assertions");
  assertionPage(errorResponse, "error assertions");
  return sample.map((assertion) => ({
    urn: urn(assertion.urn, "assertion"),
    type: text(assertion.type, "assertion type"),
    column: assertion.column === null || assertion.column === undefined
      ? null
      : text(assertion.column, "assertion column"),
    status: assertion.latestResultType === null || assertion.latestResultType === undefined
      ? "UNKNOWN"
      : text(assertion.latestResultType, "assertion status"),
  })).sort((left, right) => left.urn.localeCompare(right.urn));
}

async function assetContexts(
  tools: DataHubToolCaller,
  source: Asset,
  summaries: readonly SummaryPath[],
  oldColumn: string,
): Promise<ImpactEvidence["assets"]> {
  const assets = new Map<string, Asset>([[source.urn, source]]);
  for (const summary of summaries) assets.set(summary.downstream.urn, summary.downstream);
  const ordered = [source, ...[...assets.values()].filter((asset) => asset.urn !== source.urn)
    .sort((left, right) => left.urn.localeCompare(right.urn))];
  const rawEntities = array(
    await tools.callTool("get_entities", { urns: ordered.map((asset) => asset.urn) }),
    "get_entities response",
  );
  const returned = new Map<string, JsonRecord>();
  for (const value of rawEntities) {
    const entity = record(value, "entity");
    const entityUrn = urn(entity.urn, "entity");
    if (!assets.has(entityUrn) || returned.has(entityUrn) || entity.error) {
      throw new DataHubEvidenceError("get_entities did not match requested URNs");
    }
    returned.set(entityUrn, entity);
  }
  if (returned.size !== ordered.length) {
    throw new DataHubEvidenceError("get_entities did not return every requested URN");
  }

  const contexts: Array<ImpactEvidence["assets"][number]> = [];
  for (const asset of ordered) {
    const entity = returned.get(asset.urn) as JsonRecord;
    const statuses = new Set<string>();
    for (const rawHealth of array(entity.health ?? [], "entity health")) {
      const health = record(rawHealth, "health signal");
      if (text(health.type, "health type").toUpperCase() === "INCIDENTS") {
        statuses.add(text(health.status, "incident status").toUpperCase());
      }
    }
    let queries: ImpactEvidence["assets"][number]["queries"] = [];
    let assertions: ImpactEvidence["assets"][number]["assertions"] = [];
    if (asset.type === "dataset") {
      const column = asset.urn === source.urn
        ? oldColumn
        : summaries.find((summary) => summary.downstream.urn === asset.urn)?.downstreamColumns[0];
      const queryInput: Record<string, unknown> = { urn: asset.urn, start: 0, count: 10 };
      queries = normalizeQueries(asset.urn, await tools.callTool("get_dataset_queries", queryInput));
      assertions = await normalizeAssertions(tools, asset.urn, column);
    }
    contexts.push({
      urn: asset.urn,
      type: asset.type,
      name: asset.name,
      owners: nestedUrns(entity.ownership, "owners", "owner"),
      tags: nestedUrns(entity.tags, "tags", "tag"),
      glossaryTerms: nestedUrns(entity.glossaryTerms, "terms", "term"),
      incidentStatuses: [...statuses].sort(),
      assertions,
      queries,
      complete: true,
    });
  }
  return contexts;
}

export async function collectEvidence(
  tools: DataHubToolCaller,
  change: DbtColumnRename,
  maxHops = 3,
): Promise<ImpactEvidence> {
  try {
    if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 3) {
      throw new DataHubEvidenceError("maxHops must be an integer between 1 and 3");
    }
    const source = await resolveSource(tools, change.modelName);
    const confirmation = array(
      await tools.callTool("get_entities", { urns: [source.urn] }),
      "source confirmation",
    );
    if (confirmation.length !== 1 || urn(record(confirmation[0], "source entity").urn, "source entity") !== source.urn) {
      throw new DataHubEvidenceError("get_entities did not confirm the resolved dataset");
    }
    const schema = record(await tools.callTool("list_schema_fields", {
      urn: source.urn,
      keywords: [change.oldName],
      limit: 100,
      offset: 0,
    }), "schema response");
    const fields = array(schema.fields, "schema fields").map((field) =>
      text(record(field, "schema field").fieldPath, "schema field path"));
    if (
      integer(schema.offset, "schema offset") !== 0
      || integer(schema.returned, "schema returned") !== fields.length
      || integer(schema.remainingCount, "schema remaining count") !== 0
    ) {
      throw new DataHubEvidenceError("DataHub schema response is incomplete");
    }
    if (!fields.includes(change.oldName)) {
      throw new DataHubEvidenceError(`verified DataHub schema does not contain column ${change.oldName}`);
    }
    const summaries = normalizeLineage(await tools.callTool("get_lineage", {
      urn: source.urn,
      column: change.oldName,
      upstream: false,
      max_hops: maxHops,
      max_results: 50,
      offset: 0,
    }));
    const paths = await exactPaths(tools, source, change.oldName, summaries);
    const assets = await assetContexts(tools, source, summaries, change.oldName);
    return ImpactEvidenceSchema.parse({
      complete: true,
      capabilities: {
        datasetAssertions: tools.supportsTool?.("get_dataset_assertions") !== false,
      },
      source,
      schemaFields: fields,
      paths,
      assets,
    });
  } catch (error) {
    if (error instanceof DataHubNormalizationError || error instanceof Error) {
      throw asEvidenceError(error);
    }
    throw new DataHubEvidenceError("unknown DataHub evidence error", { cause: error });
  }
}
