import { createHash } from "node:crypto";

import type { DbtColumnRename } from "./case";
import type { WorkKind } from "./case";

function requireText(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} must be non-empty`);
  return value;
}

function requireUrn(value: string, label: string): string {
  if (!value.startsWith("urn:li:")) {
    throw new Error(`${label} must be a DataHub URN`);
  }
  return value;
}

function stableKey(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    const bytes = Buffer.from(part, "utf8");
    hash.update(String(bytes.length));
    hash.update(":");
    hash.update(bytes);
  }
  return hash.digest("hex").slice(0, 24);
}

function stableRepositoryIdentity(repository: string): string {
  const value = requireText(repository, "repository");
  // Preserve persisted keys when the product repository moves from the legacy
  // `cutset` slug to the canonical `change-marshal` slug.
  return value.replace(/(^|\/)change-marshal(?=\/|$)/, "$1cutset");
}

export function caseKey(
  repository: string,
  sourceUrn: string,
  change: DbtColumnRename,
): string {
  return stableKey([
    stableRepositoryIdentity(repository),
    requireUrn(sourceUrn, "source"),
    change.kind,
    requireText(change.sourcePath, "source path"),
    requireText(change.modelName, "model name"),
    requireText(change.oldName, "old column"),
    requireText(change.newName, "new column"),
  ]);
}

export function revisionKey(
  logicalCaseKey: string,
  baseSha: string,
  headSha: string,
  evidenceFingerprint: string,
): string {
  return stableKey([
    requireText(logicalCaseKey, "case key"),
    requireText(baseSha, "base SHA"),
    requireText(headSha, "head SHA"),
    requireText(evidenceFingerprint, "evidence fingerprint"),
  ]);
}

export function workKey(
  logicalCaseKey: string,
  ownerUrn: string,
  kind: (typeof WorkKind)[keyof typeof WorkKind],
  affectedUrns: readonly string[],
): string {
  if (affectedUrns.length === 0) throw new Error("affected URNs must be non-empty");
  const governed = [...new Set(affectedUrns.map((value) => requireUrn(value, "affected asset")))].sort();
  return stableKey([
    requireText(logicalCaseKey, "case key"),
    requireUrn(ownerUrn, "owner"),
    kind,
    ...governed,
  ]);
}

export function approvalRequirementKey(
  logicalCaseKey: string,
  role: string,
  ownerUrn: string,
  affectedUrns: readonly string[],
): string {
  if (affectedUrns.length === 0) throw new Error("affected URNs must be non-empty");
  return stableKey([
    requireText(logicalCaseKey, "case key"),
    requireText(role, "approval role"),
    requireUrn(ownerUrn, "owner"),
    ...[...new Set(affectedUrns.map((value) => requireUrn(value, "affected asset")))].sort(),
  ]);
}
