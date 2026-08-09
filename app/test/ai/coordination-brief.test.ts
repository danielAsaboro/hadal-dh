import { describe, expect, it } from "vitest";

import { validateCoordinationBrief } from "../../src/ai/coordination-brief";
import type { ChangeCase, ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";

function caseFixture(): ChangeCase {
  const source = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
  const consumer = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.orders,PROD)";
  const evidence: ImpactEvidence = {
    complete: true,
    source: { urn: source, type: "dataset", name: "customers" },
    schemaFields: ["email"],
    paths: [{ sourceUrn: source, downstreamUrn: consumer, column: "email", downstreamColumns: ["email"], nodes: [source, consumer] }],
    assets: [
      { urn: source, type: "dataset", name: "customers", owners: ["urn:li:corpuser:producer"], tags: [], glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete: true },
      { urn: consumer, type: "dataset", name: "orders", owners: ["urn:li:corpuser:consumer"], tags: [], glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete: true },
    ],
  };
  const value = compileCase(evidence, {
    repository: "acme/warehouse", baseSha: "base", headSha: "head", observedAt: "2026-08-09T10:00:00.000Z",
    change: { kind: "dbt_column_rename", modelName: "customers", oldName: "email", newName: "email_address", sourcePath: "models/schema.yml" },
  });
  return { ...value, dataHub: { verified: true, documentUrn: "urn:li:document:case", verifiedAt: "2026-08-09T10:00:00.000Z" } };
}

describe("AI SDK coordination brief boundary", () => {
  it("accepts a brief only when every case and graph reference is exact", () => {
    const value = caseFixture();
    const brief = {
      caseKey: value.caseKey,
      revisionKey: value.revision.revisionKey,
      summary: "Coordinate the verified rename across every affected owner.",
      sequence: value.workItems.map((work, index) => ({
        order: index + 1,
        workKey: work.workKey,
        action: work.title,
        validation: work.completionCriteria[0],
      })),
      risks: value.evidence.assets.map((asset) => ({
        affectedUrn: asset.urn,
        explanation: `Verified affected asset ${asset.name}`,
      })),
    };

    expect(validateCoordinationBrief(value, brief)).toEqual(brief);
  });

  it("fails closed on invented graph evidence or omitted work", () => {
    const value = caseFixture();
    expect(() => validateCoordinationBrief(value, {
      caseKey: value.caseKey,
      revisionKey: value.revision.revisionKey,
      summary: "Incomplete plan",
      sequence: [],
      risks: [{ affectedUrn: "urn:li:dataset:(urn:li:dataPlatform:dbt,invented,PROD)", explanation: "invented" }],
    })).toThrow(/exactly once|unknown affected URN/i);
  });
});
