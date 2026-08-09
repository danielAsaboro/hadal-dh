import NodeSqlParser from "node-sql-parser";

const { Parser } = NodeSqlParser;

export class DataHubNormalizationError extends Error {
  override readonly name = "DataHubNormalizationError";
}

export type JsonRecord = Readonly<Record<string, unknown>>;

export function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DataHubNormalizationError(`${label} must be an object`);
  }
  return value as JsonRecord;
}

export function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new DataHubNormalizationError(`${label} must be a list`);
  }
  return value;
}

export function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DataHubNormalizationError(`${label} must be non-empty text`);
  }
  return value;
}

export function urn(value: unknown, label: string): string {
  const result = text(value, label);
  if (!result.startsWith("urn:li:")) {
    throw new DataHubNormalizationError(`${label} omitted a valid DataHub URN`);
  }
  return result;
}

export function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new DataHubNormalizationError(`${label} must be a non-negative integer`);
  }
  return value as number;
}

export function entityType(entity: JsonRecord): string {
  const explicit = typeof entity.type === "string"
    ? entity.type.replaceAll("_", "").toLowerCase()
    : "";
  const raw = explicit || urn(entity.urn, "entity").slice("urn:li:".length).split(":", 1)[0]?.toLowerCase();
  const normalized: Readonly<Record<string, string>> = {
    dataset: "dataset",
    mlfeature: "mlFeature",
    mlmodel: "mlModel",
  };
  return normalized[raw ?? ""] ?? text(raw, "entity type");
}

export function displayName(entity: JsonRecord): string {
  const entityUrn = urn(entity.urn, "entity");
  const properties = entity.properties === undefined ? undefined : record(entity.properties, "properties");
  const editable = entity.editableProperties === undefined
    ? undefined
    : record(entity.editableProperties, "editable properties");
  const candidates = [
    properties?.displayName,
    properties?.name,
    editable?.displayName,
    entity.name,
    entity.hierarchicalName,
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?? entityUrn;
}

export function logicalDatasetName(entity: JsonRecord): string {
  const named = displayName(entity).split(".").at(-1)?.toLowerCase();
  const entityUrn = urn(entity.urn, "dataset");
  const match = /^urn:li:dataset:\([^,]+,(.*),[^,]+\)$/.exec(entityUrn);
  const urnName = match?.[1]?.split(".").at(-1)?.toLowerCase();
  return named || urnName || "";
}

function redactAst(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) redactAst(item, seen);
    return;
  }
  const node = value as Record<string, unknown>;
  if (
    typeof node.type === "string"
    && ["number", "single_quote_string", "double_quote_string", "bool", "null"].includes(node.type)
    && "value" in node
  ) {
    node.type = "origin";
    node.value = "?";
    delete node.prefix;
    return;
  }
  for (const child of Object.values(node)) redactAst(child, seen);
}

export function redactSql(statement: string): string {
  try {
    const parser = new Parser();
    const ast = parser.astify(statement);
    redactAst(ast);
    return parser.sqlify(ast).slice(0, 2000);
  } catch (error) {
    throw new DataHubNormalizationError("query statement is not valid supported SQL", { cause: error });
  }
}

export function nestedUrns(
  container: unknown,
  collectionKey: string,
  entityKey: string,
): readonly string[] {
  if (container === undefined || container === null) return [];
  const payload = record(container, entityKey);
  const values = array(payload[collectionKey] ?? [], `${entityKey}.${collectionKey}`);
  const result = new Set<string>();
  for (const value of values) {
    const wrapper = record(value, entityKey);
    const entity = record(wrapper[entityKey], entityKey);
    result.add(urn(entity.urn, entityKey));
  }
  return [...result].sort();
}
