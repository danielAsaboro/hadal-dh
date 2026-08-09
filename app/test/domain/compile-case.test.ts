import { describe, expect, it } from "vitest";

import { WorkKind, type ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";

const sourceUrn = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
const consumerA = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.orders,PROD)";
const consumerB = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.shipments,PROD)";
const modelUrn = "urn:li:mlModel:churn";
const producer = "urn:li:corpuser:producer";
const consumerOwner = "urn:li:corpuser:consumer";
const mlOwner = "urn:li:corpuser:ml";

function evidence(): ImpactEvidence {
  const context = (urn: string, type: string, name: string, owners: readonly string[]) => ({
    urn, type, name, owners, tags: [], glossaryTerms: [], incidentStatuses: [],
    assertions: [], queries: [], complete: true,
  });
  return {
    complete: true,
    source: { urn: sourceUrn, type: "dataset", name: "customers" },
    schemaFields: ["id", "email"],
    paths: [
      { sourceUrn, downstreamUrn: consumerA, column: "email", downstreamColumns: ["email"], nodes: [sourceUrn, consumerA] },
      { sourceUrn, downstreamUrn: consumerB, column: "email", downstreamColumns: ["customer_email"], nodes: [sourceUrn, consumerB] },
      { sourceUrn, downstreamUrn: modelUrn, column: "email", downstreamColumns: [], nodes: [sourceUrn, consumerA, modelUrn] },
    ],
    assets: [
      context(sourceUrn, "dataset", "customers", [producer]),
      context(consumerA, "dataset", "orders", [consumerOwner]),
      context(consumerB, "dataset", "shipments", [consumerOwner]),
      context(modelUrn, "mlModel", "churn", [mlOwner]),
    ],
  };
}

const git = {
  repository: "acme/warehouse",
  baseSha: "base-sha",
  headSha: "head-sha",
  observedAt: "2026-08-09T09:00:00.000Z",
  change: {
    kind: "dbt_column_rename" as const,
    modelName: "customers",
    oldName: "email",
    newName: "email_address",
    sourcePath: "models/customers.yml",
  },
};

describe("case compilation", () => {
  it("derives owner-grouped work, approvals, and exact path references", () => {
    const result = compileCase(evidence(), git);

    expect(result.state).toBe("planned");
    expect(result.workItems).toHaveLength(3);
    const consumerWork = result.workItems.find((item) =>
      item.kind === WorkKind.ConsumerAcknowledgement && item.ownerUrn === consumerOwner);
    expect(consumerWork?.affectedUrns).toEqual([consumerA, consumerB]);
    expect(consumerWork?.lineagePathIndexes).toEqual([0, 1]);
    expect(result.workItems.find((item) => item.kind === WorkKind.MlValidation)?.lineagePathIndexes)
      .toEqual([2]);
    expect(result.approvalRequirements.map(({ role, ownerUrn, affectedUrns }) =>
      [role, ownerUrn, affectedUrns])).toEqual([
      ["producer", producer, [sourceUrn]],
      ["consumer", consumerOwner, [consumerA, consumerB]],
      ["consumer", mlOwner, [modelUrn]],
    ]);
    expect(result.revision.evidenceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("never chooses among absent or ambiguous owners", () => {
    const original = evidence();
    const input: ImpactEvidence = {
      ...original,
      assets: original.assets.map((asset, index) => index === 1
        ? { ...asset, owners: [] }
        : index === 2
          ? { ...asset, owners: [consumerOwner, "urn:li:corpuser:second"] }
          : asset),
    };

    const result = compileCase(input, git);

    expect(result.state).toBe("blocked_ownership");
    expect(result.workItems.some((item) => item.affectedUrns.includes(consumerA))).toBe(false);
    expect(result.workItems.some((item) => item.affectedUrns.includes(consumerB))).toBe(false);
  });

  it("preserves facts only when rerunning the identical revision", () => {
    const first = compileCase(evidence(), git);
    const existing = {
      ...first,
      ownerMappings: [[producer, "producer-gh"]] as Array<[string, string]>,
      dataHub: {
        verified: true,
        documentUrn: "urn:li:document:cutset",
        verifiedAt: "2026-08-09T09:10:00.000Z",
      },
    };

    const same = compileCase(evidence(), { ...git, observedAt: "2026-08-09T09:20:00.000Z" }, existing);
    const changed = compileCase(evidence(), {
      ...git,
      headSha: "new-head",
      observedAt: "2026-08-09T09:30:00.000Z",
    }, existing);

    expect(same.ownerMappings).toEqual([[producer, "producer-gh"]]);
    expect(same.dataHub.verified).toBe(true);
    expect(changed.revision.revisionKey).not.toBe(first.revision.revisionKey);
    expect(changed.ownerMappings).toEqual([[producer, "producer-gh"]]);
    expect(changed.dataHub).toEqual({ verified: false });
  });

  it("blocks incomplete evidence without deriving work", () => {
    const result = compileCase({ ...evidence(), complete: false }, git);

    expect(result.state).toBe("blocked_context");
    expect(result.workItems).toEqual([]);
    expect(result.approvalRequirements).toEqual([]);
  });
});
