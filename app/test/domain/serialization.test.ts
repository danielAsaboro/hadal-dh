import { describe, expect, it } from "vitest";

import {
  ChangeCaseSchema,
  type ChangeCase,
  WorkKind,
} from "../../src/domain/case";
import { caseKey, revisionKey, workKey } from "../../src/domain/identity";
import {
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

describe("canonical case serialization", () => {
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
