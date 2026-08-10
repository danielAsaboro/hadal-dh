import { describe, expect, it } from "vitest";

import {
  ChangeCaseSchema,
  type ChangeCase,
  WorkKind,
} from "../../src/domain/case";
import { caseKey, revisionKey, workKey } from "../../src/domain/identity";
import {
  canonicalValueHash,
  caseContentHash,
  parseCase,
  serializeCase,
} from "../../src/domain/serialization";

const sourceUrn =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
const downstreamUrn =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customer_features,PROD)";
const ownerUrn = "urn:li:corpuser:data-owner";
const change = {
  kind: "dbt_column_rename" as const,
  modelName: "customers",
  oldName: "email",
  newName: "email_address",
  sourcePath: "models/customers.yml",
};

function exampleCase(): ChangeCase {
  const logical = caseKey("owner/repo", sourceUrn, change);
  const fingerprint = "e".repeat(64);
  const revision = revisionKey(logical, "base", "head", fingerprint);
  const itemKey = workKey(
    logical,
    ownerUrn,
    WorkKind.ConsumerAcknowledgement,
    [downstreamUrn],
  );

  return ChangeCaseSchema.parse({
    schemaVersion: 1,
    caseKey: logical,
    repository: "owner/repo",
    change,
    evidence: {
      complete: true,
      source: { urn: sourceUrn, type: "dataset", name: "analytics.customers" },
      schemaFields: ["customer_id", "email"],
      paths: [
        {
          sourceUrn,
          downstreamUrn,
          column: "email",
          downstreamColumns: ["email_hash"],
          nodes: [sourceUrn, downstreamUrn],
        },
      ],
      assets: [
        {
          urn: downstreamUrn,
          type: "dataset",
          name: "analytics.customer_features",
          owners: [ownerUrn],
          tags: [],
          glossaryTerms: [],
          incidentStatuses: [],
          assertions: [],
          queries: [],
          complete: true,
        },
      ],
    },
    revision: {
      revisionKey: revision,
      baseSha: "base",
      headSha: "head",
      evidenceFingerprint: fingerprint,
      createdAt: "2026-08-09T12:00:00Z",
    },
    state: "planned",
    workItems: [
      {
        workKey: itemKey,
        revisionKey: revision,
        kind: WorkKind.ConsumerAcknowledgement,
        ownerUrn,
        affectedUrns: [downstreamUrn],
        lineagePathIndexes: [0],
        title: "Acknowledge customers.email migration",
        completionCriteria: ["consumer_approval"],
      },
    ],
    approvalRequirements: [],
    approvalDecisions: [],
    validationReceipts: [],
    externalProjections: [],
    ownerMappings: [],
    dataHub: { verified: false },
    createdAt: "2026-08-09T12:00:00Z",
    updatedAt: "2026-08-09T12:00:00Z",
  });
}

function durableRun(value: ChangeCase) {
  return {
    runId: "run-audit-1",
    caseKey: value.caseKey,
    revisionKey: value.revision.revisionKey,
    headSha: value.revision.headSha,
    modelId: "qwen3.6-27b",
    status: "completed",
    events: [
      { kind: "run_started", sequence: 1, at: "2026-08-09T12:01:00.000Z", summary: "Run started" },
      { kind: "run_completed", sequence: 2, at: "2026-08-09T12:02:00.000Z", summary: "Run completed" },
    ],
    answer: "Verified outcome",
    createdAt: "2026-08-09T12:01:00.000Z",
    updatedAt: "2026-08-09T12:02:00.000Z",
  };
}

describe("canonical case serialization", () => {
  it("materializes an empty durable agent audit list for existing schema-v1 cases", () => {
    const legacy = JSON.parse(serializeCase(exampleCase())) as Record<string, unknown>;
    delete legacy.agentRuns;

    const parsed = ChangeCaseSchema.parse(legacy) as ChangeCase & { agentRuns?: readonly unknown[] };

    expect(parsed.agentRuns).toEqual([]);
  });

  it("verifies and migrates a sealed pre-agent-audit schema-v1 payload", () => {
    const legacy = JSON.parse(serializeCase(exampleCase())) as Record<string, unknown>;
    delete legacy.agentRuns;
    delete legacy.contentHash;
    legacy.contentHash = canonicalValueHash(legacy);

    const parsed = parseCase(JSON.stringify(legacy));

    expect(parsed.agentRuns).toEqual([]);
    expect(parsed.contentHash).toBe(legacy.contentHash);
  });

  it("rejects raw approval tokens and unknown secrets in durable agent audit records", () => {
    const value = exampleCase();

    expect(() => ChangeCaseSchema.parse({
      ...value,
      agentRuns: [{ ...durableRun(value), token: "must-never-reach-datahub" }],
    })).toThrow();
  });

  it("rejects a durable agent run attached to a different canonical case", () => {
    const value = exampleCase();

    expect(() => ChangeCaseSchema.parse({
      ...value,
      agentRuns: [{ ...durableRun(value), caseKey: "f".repeat(24) }],
    })).toThrow(/agent run case/i);
  });

  it("round-trips to byte-stable canonical JSON", () => {
    const encoded = serializeCase(exampleCase());

    expect(serializeCase(parseCase(encoded))).toBe(encoded);
    expect(encoded.endsWith("\n")).toBe(true);
  });

  it("excludes only contentHash from its content digest", () => {
    const original = exampleCase();
    const digest = caseContentHash(original);

    expect(digest).toHaveLength(64);
    expect(caseContentHash({ ...original, contentHash: digest })).toBe(digest);
  });

  it("rejects unknown schema versions", () => {
    const payload = JSON.parse(serializeCase(exampleCase())) as Record<
      string,
      unknown
    >;
    payload.schemaVersion = 2;

    expect(() => parseCase(JSON.stringify(payload))).toThrow(/schemaVersion/i);
  });

  it("rejects content tampering after hashing", () => {
    const original = exampleCase();
    const payload = {
      ...original,
      contentHash: caseContentHash(original),
      repository: "attacker/repo",
    };

    expect(() => parseCase(JSON.stringify(payload))).toThrow(/content hash/i);
  });
});
