import { describe, expect, it } from "vitest";

import { ApprovalVerdict, type ChangeCase, type ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import {
  ApprovalRecordingError,
  recordApproval,
  type VerifiedActorSource,
} from "../../src/actions/approval";

const producer = "urn:li:corpuser:producer";

function planned(): ChangeCase {
  const source = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
  const evidence: ImpactEvidence = {
    complete: true,
    source: { urn: source, type: "dataset", name: "customers" },
    schemaFields: ["email"], paths: [],
    assets: [{ urn: source, type: "dataset", name: "customers", owners: [producer], tags: [], glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete: true }],
  };
  const value = compileCase(evidence, {
    repository: "acme/warehouse", baseSha: "base", headSha: "head", observedAt: "2026-08-09T10:00:00.000Z",
    change: { kind: "dbt_column_rename", modelName: "customers", oldName: "email", newName: "email_address", sourcePath: "models/schema.yml" },
  });
  return { ...value, ownerMappings: [[producer, "producer-gh"]] };
}

const verifiedActor: VerifiedActorSource = {
  verifyActor: async (expected) => ({ login: expected, permission: "write" }),
};

describe("approval recording", () => {
  it("records a verified owner decision bound to revision and head", async () => {
    const value = planned();
    const requirement = value.approvalRequirements[0]!;

    const updated = await recordApproval(value, {
      requirementKey: requirement.requirementKey,
      verdict: ApprovalVerdict.Approve,
      currentHeadSha: "head",
      decidedAt: "2026-08-09T10:05:00.000Z",
    }, verifiedActor);

    expect(updated.approvalDecisions).toEqual([{
      requirementKey: requirement.requirementKey,
      revisionKey: value.revision.revisionKey,
      headSha: "head",
      role: "producer",
      ownerUrn: producer,
      actorLogin: "producer-gh",
      verdict: "approve",
      decidedAt: "2026-08-09T10:05:00.000Z",
      source: "github",
    }]);
  });

  it("is idempotent for the same decision and rejects conflicts", async () => {
    const value = planned();
    const requirementKey = value.approvalRequirements[0]!.requirementKey;
    const input = { requirementKey, verdict: ApprovalVerdict.Approve, currentHeadSha: "head", decidedAt: "2026-08-09T10:05:00.000Z" };
    const once = await recordApproval(value, input, verifiedActor);
    const twice = await recordApproval(once, input, verifiedActor);
    expect(twice.approvalDecisions).toHaveLength(1);

    await expect(recordApproval(once, { ...input, verdict: ApprovalVerdict.Reject }, verifiedActor))
      .rejects.toThrow(/conflicting/i);
  });

  it("rejects stale heads, unknown requirements, and a mismatched verified actor", async () => {
    const value = planned();
    const requirementKey = value.approvalRequirements[0]!.requirementKey;
    await expect(recordApproval(value, {
      requirementKey, verdict: ApprovalVerdict.Approve, currentHeadSha: "other", decidedAt: "2026-08-09T10:05:00.000Z",
    }, verifiedActor)).rejects.toThrow(/head/i);
    await expect(recordApproval(value, {
      requirementKey: "a".repeat(24), verdict: ApprovalVerdict.Approve, currentHeadSha: "head", decidedAt: "2026-08-09T10:05:00.000Z",
    }, verifiedActor)).rejects.toThrow(/requirement/i);
    await expect(recordApproval(value, {
      requirementKey, verdict: ApprovalVerdict.Approve, currentHeadSha: "head", decidedAt: "2026-08-09T10:05:00.000Z",
    }, { verifyActor: async () => ({ login: "attacker", permission: "admin" }) }))
      .rejects.toBeInstanceOf(ApprovalRecordingError);
  });
});
