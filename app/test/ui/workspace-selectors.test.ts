import { describe, expect, it } from "vitest";

import type { ChangeCase, ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import * as workspaceModule from "../../src/ui/Workspace";

function governedCase(modelName: string, updatedAt: string): ChangeCase {
  const source = `urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.${modelName},PROD)`;
  const consumer = `urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.${modelName}_consumer,PROD)`;
  const evidence: ImpactEvidence = {
    complete: true,
    source: { urn: source, type: "dataset", name: modelName },
    schemaFields: ["email"],
    paths: [{ sourceUrn: source, downstreamUrn: consumer, column: "email", downstreamColumns: ["email"], nodes: [source, consumer] }],
    assets: [
      { urn: source, type: "dataset", name: modelName, owners: ["urn:li:corpuser:producer"], tags: [], glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete: true },
      { urn: consumer, type: "dataset", name: `${modelName}_consumer`, owners: ["urn:li:corpuser:consumer"], tags: [], glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete: true },
    ],
  };
  const value = compileCase(evidence, {
    repository: `acme/${modelName}`,
    baseSha: "base",
    headSha: `head-${modelName}`,
    observedAt: updatedAt,
    change: { kind: "dbt_column_rename", modelName, oldName: "email", newName: "email_address", sourcePath: `models/${modelName}.yml` },
  });
  return { ...value, updatedAt };
}

function withHumanDecisions(value: ChangeCase): ChangeCase {
  return {
    ...value,
    approvalDecisions: value.approvalRequirements.map((requirement, index) => ({
      requirementKey: requirement.requirementKey,
      revisionKey: requirement.revisionKey,
      headSha: value.revision.headSha,
      role: requirement.role,
      ownerUrn: requirement.ownerUrn,
      actorLogin: `reviewer-${index}`,
      verdict: "approve" as const,
      decidedAt: value.updatedAt,
      source: "github" as const,
    })),
    admission: {
      allowed: true,
      blockers: [],
      revisionKey: value.revision.revisionKey,
      headSha: value.revision.headSha,
      evaluatedAt: value.updatedAt,
    },
  };
}

type SelectorApi = Readonly<{
  selectAttentionCases: (cases: readonly ChangeCase[]) => readonly Readonly<{
    case: ChangeCase;
    category: "failed" | "approval" | "blocked" | "active" | "resolved";
    latestAt: string;
  }>[];
  selectWorkRows: (cases: readonly ChangeCase[]) => readonly unknown[];
  selectApprovalRows: (cases: readonly ChangeCase[]) => readonly unknown[];
  paginateRows: <T>(rows: readonly T[], page: number) => Readonly<{ rows: readonly T[]; page: number; pageCount: number; total: number }>;
}>;

const selectors = workspaceModule as unknown as Partial<SelectorApi>;

describe("workspace operational selectors", () => {
  it("deduplicates attention cases by deterministic priority, sorts within groups, and caps the result at eight", () => {
    expect(typeof selectors.selectAttentionCases).toBe("function");
    if (selectors.selectAttentionCases === undefined) return;

    const failedOlder = { ...governedCase("failed-older", "2026-08-09T10:00:00.000Z"), state: "stale" as const };
    const failedNewer = { ...governedCase("failed-newer", "2026-08-09T12:00:00.000Z"), state: "stale" as const };
    const approvalOlder = governedCase("approval-older", "2026-08-09T09:00:00.000Z");
    const approvalNewer = governedCase("approval-newer", "2026-08-09T13:00:00.000Z");
    const blockedOlder = { ...withHumanDecisions(governedCase("blocked-older", "2026-08-09T08:00:00.000Z")), state: "blocked_ownership" as const };
    const blockedNewer = { ...withHumanDecisions(governedCase("blocked-newer", "2026-08-09T14:00:00.000Z")), state: "blocked_validation" as const };
    const activeOlder = { ...withHumanDecisions(governedCase("active-older", "2026-08-09T07:00:00.000Z")), state: "in_progress" as const };
    const activeNewer = { ...withHumanDecisions(governedCase("active-newer", "2026-08-09T15:00:00.000Z")), state: "ready" as const };
    const resolved = { ...withHumanDecisions(governedCase("resolved", "2026-08-09T16:00:00.000Z")), state: "resolved" as const };

    const result = selectors.selectAttentionCases([
      resolved, activeOlder, blockedOlder, approvalOlder, failedOlder,
      activeNewer, blockedNewer, approvalNewer, failedNewer,
    ]);

    expect(result).toHaveLength(8);
    expect(result.map((row) => [row.category, row.case.change.modelName])).toEqual([
      ["failed", "failed-newer"],
      ["failed", "failed-older"],
      ["approval", "approval-newer"],
      ["approval", "approval-older"],
      ["blocked", "blocked-newer"],
      ["blocked", "blocked-older"],
      ["active", "active-newer"],
      ["active", "active-older"],
    ]);
    expect(new Set(result.map((row) => row.case.caseKey)).size).toBe(result.length);
  });

  it("flattens real work and approval facts and paginates every collection at twenty-five rows", () => {
    expect(typeof selectors.selectWorkRows).toBe("function");
    expect(typeof selectors.selectApprovalRows).toBe("function");
    expect(typeof selectors.paginateRows).toBe("function");
    if (selectors.selectWorkRows === undefined || selectors.selectApprovalRows === undefined || selectors.paginateRows === undefined) return;

    const first = governedCase("first", "2026-08-09T10:00:00.000Z");
    const second = governedCase("second", "2026-08-09T11:00:00.000Z");
    expect(selectors.selectWorkRows([first, second])).toHaveLength(first.workItems.length + second.workItems.length);
    expect(selectors.selectApprovalRows([first, second])).toHaveLength(first.approvalRequirements.length + second.approvalRequirements.length);

    const rows = Array.from({ length: 51 }, (_, index) => `row-${index + 1}`);
    expect(selectors.paginateRows(rows, 1)).toEqual({ rows: rows.slice(0, 25), page: 1, pageCount: 3, total: 51 });
    expect(selectors.paginateRows(rows, 2)).toEqual({ rows: rows.slice(25, 50), page: 2, pageCount: 3, total: 51 });
    expect(selectors.paginateRows(rows, 99)).toEqual({ rows: rows.slice(50), page: 3, pageCount: 3, total: 51 });
  });
});
