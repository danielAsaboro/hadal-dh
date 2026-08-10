import type { ChangeCase } from "../domain/case";

export const WORKSPACE_PAGE_SIZE = 25;

export type AttentionCategory = "failed" | "approval" | "blocked" | "active" | "resolved";

export interface AttentionCase {
  readonly case: ChangeCase;
  readonly category: AttentionCategory;
  readonly latestAt: string;
}

export interface WorkRow {
  readonly case: ChangeCase;
  readonly work: ChangeCase["workItems"][number];
  readonly projections: ChangeCase["externalProjections"];
  readonly receipts: ChangeCase["validationReceipts"];
}

export type ApprovalRow =
  | Readonly<{
    kind: "human";
    case: ChangeCase;
    requirement: ChangeCase["approvalRequirements"][number];
    decisions: ChangeCase["approvalDecisions"];
  }>
  | Readonly<{
    kind: "qvac";
    case: ChangeCase;
    run: ChangeCase["agentRuns"][number];
    pending: NonNullable<ChangeCase["agentRuns"][number]["pendingApproval"]>;
  }>;

function realTimestamps(value: ChangeCase): readonly string[] {
  return [
    value.createdAt,
    value.updatedAt,
    value.revision.createdAt,
    ...(value.admission === undefined ? [] : [value.admission.evaluatedAt]),
    ...value.approvalDecisions.map((decision) => decision.decidedAt),
    ...value.validationReceipts.flatMap((receipt) => [receipt.startedAt, receipt.finishedAt]),
    ...value.externalProjections.flatMap((projection) => projection.verifiedAt === null ? [] : [projection.verifiedAt]),
    ...value.agentRuns.flatMap((run) => [run.createdAt, run.updatedAt, ...run.events.map((event) => event.at)]),
  ];
}

export function latestCaseTimestamp(value: ChangeCase): string {
  return realTimestamps(value).reduce((latest, timestamp) => {
    const instantDifference = Date.parse(timestamp) - Date.parse(latest);
    return instantDifference > 0 || (instantDifference === 0 && timestamp.localeCompare(latest) > 0)
      ? timestamp
      : latest;
  }, value.createdAt);
}

function hasMissingHumanDecision(value: ChangeCase): boolean {
  return value.approvalRequirements.some((requirement) => !value.approvalDecisions.some((decision) => (
    decision.requirementKey === requirement.requirementKey
    && decision.revisionKey === value.revision.revisionKey
    && decision.headSha === value.revision.headSha
  )));
}

function attentionCategory(value: ChangeCase): AttentionCategory {
  if (
    value.state === "stale"
    || value.externalProjections.some((projection) => projection.state === "error")
    || value.validationReceipts.some((receipt) => !receipt.valid)
  ) return "failed";
  if (
    hasMissingHumanDecision(value)
    || value.agentRuns.some((run) => run.status === "waiting_for_approval" && run.pendingApproval !== undefined)
  ) return "approval";
  if (value.state.startsWith("blocked_") || (value.admission?.blockers.length ?? 0) > 0) return "blocked";
  if (value.state === "resolved") return "resolved";
  return "active";
}

const attentionOrder: Record<AttentionCategory, number> = {
  failed: 0,
  approval: 1,
  blocked: 2,
  active: 3,
  resolved: 4,
};

function newestFirst(left: Readonly<{ latestAt: string; case: ChangeCase }>, right: Readonly<{ latestAt: string; case: ChangeCase }>): number {
  return Date.parse(right.latestAt) - Date.parse(left.latestAt) || left.case.caseKey.localeCompare(right.case.caseKey);
}

export function selectAttentionCases(cases: readonly ChangeCase[]): readonly AttentionCase[] {
  return cases
    .map((value) => ({ case: value, category: attentionCategory(value), latestAt: latestCaseTimestamp(value) }))
    .sort((left, right) => attentionOrder[left.category] - attentionOrder[right.category] || newestFirst(left, right))
    .slice(0, 8);
}

export function selectActiveCases(cases: readonly ChangeCase[], limit = 5): readonly ChangeCase[] {
  return cases
    .filter((value) => attentionCategory(value) === "active")
    .map((value) => ({ case: value, latestAt: latestCaseTimestamp(value) }))
    .sort(newestFirst)
    .slice(0, limit)
    .map((row) => row.case);
}

export function selectRecentlyResolvedCases(cases: readonly ChangeCase[], limit = 5): readonly ChangeCase[] {
  return cases
    .filter((value) => value.state === "resolved")
    .map((value) => ({ case: value, latestAt: latestCaseTimestamp(value) }))
    .sort(newestFirst)
    .slice(0, limit)
    .map((row) => row.case);
}

export function caseMatchesQuery(value: ChangeCase, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) return true;
  return [value.caseKey, value.repository, value.change.modelName]
    .some((candidate) => candidate.toLocaleLowerCase().includes(normalized));
}

export function selectWorkRows(cases: readonly ChangeCase[]): readonly WorkRow[] {
  return cases.flatMap((value) => value.workItems.map((work) => ({
    case: value,
    work,
    projections: value.externalProjections.filter((projection) => projection.workKey === work.workKey),
    receipts: value.validationReceipts.filter((receipt) => receipt.workKey === work.workKey),
  })));
}

export function selectApprovalRows(cases: readonly ChangeCase[]): readonly ApprovalRow[] {
  return cases.flatMap((value) => [
    ...value.approvalRequirements.map((requirement): ApprovalRow => ({
      kind: "human",
      case: value,
      requirement,
      decisions: value.approvalDecisions
        .filter((decision) => decision.requirementKey === requirement.requirementKey)
        .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt)),
    })),
    ...value.agentRuns.flatMap((run): readonly ApprovalRow[] => run.status === "waiting_for_approval" && run.pendingApproval !== undefined
      ? [{ kind: "qvac", case: value, run, pending: run.pendingApproval }]
      : []),
  ]);
}

export function paginateRows<T>(rows: readonly T[], requestedPage: number): Readonly<{
  rows: readonly T[];
  page: number;
  pageCount: number;
  total: number;
}> {
  const pageCount = Math.max(1, Math.ceil(rows.length / WORKSPACE_PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Math.trunc(requestedPage) || 1));
  const start = (page - 1) * WORKSPACE_PAGE_SIZE;
  return { rows: rows.slice(start, start + WORKSPACE_PAGE_SIZE), page, pageCount, total: rows.length };
}
