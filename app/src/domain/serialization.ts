import { createHash } from "node:crypto";

import { ChangeCaseSchema, type ChangeCase } from "./case";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  throw new Error(`unsupported canonical JSON value: ${typeof value}`);
}

function withoutContentHash(value: ChangeCase): Record<string, unknown> {
  const { contentHash: _contentHash, ...content } = value;
  return content;
}

export function caseContentHash(value: ChangeCase): string {
  const canonical = JSON.stringify(canonicalize(withoutContentHash(value)));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function serializeCase(value: ChangeCase): string {
  const parsed = ChangeCaseSchema.parse(value);
  return `${JSON.stringify(canonicalize(parsed), null, 2)}\n`;
}

export function parseCase(serialized: string): ChangeCase {
  const candidate: unknown = JSON.parse(serialized);
  const parsed = ChangeCaseSchema.parse(candidate);
  if (parsed.contentHash && parsed.contentHash !== caseContentHash(parsed)) {
    throw new Error("case content hash does not match content");
  }
  return parsed;
}
