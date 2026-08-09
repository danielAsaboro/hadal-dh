import { describe, expect, it } from "vitest";

import {
  ApprovalVerdict,
  ProjectionState,
  type ChangeCase,
  type ImpactEvidence,
} from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import { evaluateCase } from "../../src/domain/policy";

const source = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
const consumer = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.orders,PROD)";
const producer = "urn:li:corpuser:producer";
const consumerOwner = "urn:li:corpuser:consumer";
const now = "2026-08-09T10:00:00.000Z";

function baseEvidence(): ImpactEvidence {
  const context = (urn: string, name: string, owners: readonly string[]) => ({
    urn, type: "dataset", name, owners, tags: [], glossaryTerms: [], incidentStatuses: [],
    assertions: [], queries: [], complete: true,
  });
  return {
    complete: true,
    source: { urn: source, type: "dataset", name: "customers" },
    schemaFields: ["email"],
    paths: [{ sourceUrn: source, downstreamUrn: consumer, column: "email", downstreamColumns: ["email"], nodes: [source, consumer] }],
    assets: [context(source, "customers", [producer]), context(consumer, "orders", [consumerOwner])],
  };
}

function planned(): ChangeCase {
  return compileCase(baseEvidence(), {
    repository: "acme/warehouse", baseSha: "base", headSha: "head", observedAt: now,
    change: { kind: "dbt_column_rename", modelName: "customers", oldName: "email", newName: "email_address", sourcePath: "models/schema.yml" },
  });
}

function readyFacts(): ChangeCase {
  const value = planned();
  const mappings: Array<[string, string]> = [[producer, "producer-gh"], [consumerOwner, "consumer-gh"]];
  const login = new Map<string, string>(mappings);
  return {
    ...value,
    ownerMappings: mappings,
    externalProjections: value.workItems.map((work, index) => ({
      system: "github" as const,
      workKey: work.workKey,
      externalId: String(index + 1),
      url: `https://github.com/acme/warehouse/issues/${index + 1}`,
      state: ProjectionState.Verified,
      revisionKey: value.revision.revisionKey,
      headSha: value.revision.headSha,
      assignee: login.get(work.ownerUrn) as string,
      verifiedAt: now,
    })),
    validationReceipts: value.workItems.map((work) => ({
      receiptKey: work.workKey,
      workKey: work.workKey,
      revisionKey: value.revision.revisionKey,
      headSha: value.revision.headSha,
      command: ["npm", "test"],
      exitCode: 0,
      stdoutSha256: "a".repeat(64),
      stderrSha256: "b".repeat(64),
      artifactHashes: [],
      startedAt: now,
      finishedAt: now,
      valid: true,
    })),
    approvalDecisions: value.approvalRequirements.map((requirement) => ({
      requirementKey: requirement.requirementKey,
      revisionKey: value.revision.revisionKey,
      headSha: value.revision.headSha,
      role: requirement.role,
      ownerUrn: requirement.ownerUrn,
      actorLogin: login.get(requirement.ownerUrn) as string,
      verdict: ApprovalVerdict.Approve,
      decidedAt: now,
      source: "github" as const,
    })),
    dataHub: { verified: true, documentUrn: "urn:li:document:cutset", verifiedAt: now },
  };
}

describe("deterministic admission policy", () => {
  it("allows only a complete, current, verified case", () => {
    const result = evaluateCase(readyFacts(), { currentHeadSha: "head", evaluatedAt: now });

    expect(result.state).toBe("ready");
    expect(result.admission.allowed).toBe(true);
    expect(result.admission.blockers).toEqual([]);
  });

  it("reports every missing prerequisite with stable blocker codes", () => {
    const result = evaluateCase(planned(), { currentHeadSha: "head", evaluatedAt: now });

    expect(result.admission.allowed).toBe(false);
    expect(result.admission.blockers).toContain(`OWNER_MAPPING_MISSING:${producer}`);
    expect(result.admission.blockers).toContain(`OWNER_MAPPING_MISSING:${consumerOwner}`);
    expect(result.admission.blockers.some((code) => code.startsWith("PROJECTION_MISSING:"))).toBe(true);
    expect(result.admission.blockers.some((code) => code.startsWith("VALIDATION_MISSING:"))).toBe(true);
    expect(result.admission.blockers.some((code) => code.startsWith("APPROVAL_MISSING:"))).toBe(true);
    expect(result.admission.blockers).toContain("DATAHUB_WRITEBACK_UNVERIFIED");
  });

  it("rejects stale heads, failed receipts, bad projections, and rejection decisions", () => {
    const original = readyFacts();
    const value: ChangeCase = {
      ...original,
      validationReceipts: original.validationReceipts.map((receipt, index) => index === 0
        ? { ...receipt, valid: false, exitCode: 1 }
        : receipt),
      externalProjections: original.externalProjections.map((projection, index) => index === 0
        ? { ...projection, state: ProjectionState.Error }
        : projection),
      approvalDecisions: original.approvalDecisions.map((decision, index) => index === 0
        ? { ...decision, verdict: ApprovalVerdict.Reject }
        : decision),
    };

    const result = evaluateCase(value, { currentHeadSha: "different-head", evaluatedAt: now });

    expect(result.state).toBe("stale");
    expect(result.admission.blockers).toContain("HEAD_SHA_STALE");
    expect(result.admission.blockers).toContain(`PROJECTION_UNVERIFIED:${value.workItems[0]?.workKey}`);
    expect(result.admission.blockers).toContain(`VALIDATION_FAILED:${value.workItems[0]?.workKey}`);
    expect(result.admission.blockers).toContain(`APPROVAL_REJECTED:${value.approvalRequirements[0]?.requirementKey}`);
  });

  it("blocks missing and ambiguous graph ownership before external work", () => {
    const original = baseEvidence();
    const evidence: ImpactEvidence = {
      ...original,
      assets: original.assets.map((asset, index) => index === 0
        ? { ...asset, owners: [] }
        : { ...asset, owners: [consumerOwner, "urn:li:corpuser:other"] }),
    };
    const value = compileCase(evidence, {
      repository: "acme/warehouse", baseSha: "base", headSha: "head", observedAt: now,
      change: { kind: "dbt_column_rename", modelName: "customers", oldName: "email", newName: "email_address", sourcePath: "models/schema.yml" },
    });

    const result = evaluateCase(value, { currentHeadSha: "head", evaluatedAt: now });

    expect(result.state).toBe("blocked_ownership");
    expect(result.admission.blockers).toContain(`OWNERSHIP_MISSING:${source}`);
    expect(result.admission.blockers).toContain(`OWNERSHIP_AMBIGUOUS:${consumer}`);
  });
});
