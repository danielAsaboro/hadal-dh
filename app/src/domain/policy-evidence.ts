import {
  ApprovalVerdict,
  ProjectionState,
  type ChangeCase,
} from "./case";

type WorkItem = ChangeCase["workItems"][number];
type Projection = ChangeCase["externalProjections"][number];
type ApprovalRequirement = ChangeCase["approvalRequirements"][number];
type ApprovalDecision = ChangeCase["approvalDecisions"][number];

export type ProjectionDefect = "state" | "revision" | "head" | "verification_time" | "assignee";
export type ApprovalDecisionDefect = "revision" | "head" | "role" | "owner" | "actor" | "provenance";

export interface OwnerMappingIndex {
  readonly loginByOwner: ReadonlyMap<string, string>;
  readonly ambiguousOwners: ReadonlySet<string>;
}

export interface ProjectionRecordInspection {
  readonly value: Projection;
  readonly defects: readonly ProjectionDefect[];
  readonly verified: boolean;
}

export interface WorkProjectionInspection {
  readonly collection: "missing" | "single" | "conflict";
  readonly expectedAssignee?: string;
  readonly records: readonly ProjectionRecordInspection[];
  readonly verified: boolean;
  readonly policyBlocker?: `PROJECTION_MISSING:${string}` | `PROJECTION_UNVERIFIED:${string}`;
}

export interface ApprovalDecisionRecordInspection {
  readonly value: ApprovalDecision;
  readonly defects: readonly ApprovalDecisionDefect[];
  readonly verified: boolean;
}

export interface ApprovalRequirementInspection {
  readonly collection: "missing" | "single" | "conflict";
  readonly expectedActor?: string;
  readonly records: readonly ApprovalDecisionRecordInspection[];
  readonly verifiedDecision?: ApprovalDecision;
  readonly policyBlocker?:
    | `APPROVAL_MISSING:${string}`
    | `APPROVAL_CONFLICT:${string}`
    | `APPROVAL_UNVERIFIED:${string}`
    | `APPROVAL_PROVENANCE_MISSING:${string}`
    | `APPROVAL_REJECTED:${string}`;
}

export function indexOwnerMappings(value: ChangeCase): OwnerMappingIndex {
  const loginByOwner = new Map<string, string>();
  const ambiguousOwners = new Set<string>();
  for (const [owner, login] of value.ownerMappings) {
    if (loginByOwner.has(owner) && loginByOwner.get(owner) !== login) ambiguousOwners.add(owner);
    loginByOwner.set(owner, login);
  }
  return { loginByOwner, ambiguousOwners };
}

function projectionDefects(
  value: ChangeCase,
  projection: Projection,
  expectedAssignee: string | undefined,
): readonly ProjectionDefect[] {
  const defects: ProjectionDefect[] = [];
  if (projection.state !== ProjectionState.Verified) defects.push("state");
  if (projection.revisionKey !== value.revision.revisionKey) defects.push("revision");
  if (projection.headSha !== value.revision.headSha) defects.push("head");
  if (projection.verifiedAt === null) defects.push("verification_time");
  if (projection.assignee !== expectedAssignee) defects.push("assignee");
  return defects;
}

export function inspectWorkProjection(
  value: ChangeCase,
  work: WorkItem,
  ownerMappings: OwnerMappingIndex = indexOwnerMappings(value),
): WorkProjectionInspection {
  const projections = value.externalProjections.filter((projection) => projection.workKey === work.workKey);
  const collection = projections.length === 0 ? "missing" : projections.length === 1 ? "single" : "conflict";
  const expectedAssignee = ownerMappings.loginByOwner.get(work.ownerUrn);
  const records = projections.map((projection) => {
    const defects = projectionDefects(value, projection, expectedAssignee);
    return { value: projection, defects, verified: collection === "single" && defects.length === 0 };
  });
  const verified = records.length === 1 && records[0]!.verified;
  return {
    collection,
    ...(expectedAssignee === undefined ? {} : { expectedAssignee }),
    records,
    verified,
    ...(!verified ? {
      policyBlocker: collection === "missing"
        ? `PROJECTION_MISSING:${work.workKey}` as const
        : `PROJECTION_UNVERIFIED:${work.workKey}` as const,
    } : {}),
  };
}

function approvalDefects(
  value: ChangeCase,
  requirement: ApprovalRequirement,
  decision: ApprovalDecision,
  expectedActor: string | undefined,
): readonly ApprovalDecisionDefect[] {
  const defects: ApprovalDecisionDefect[] = [];
  if (decision.revisionKey !== value.revision.revisionKey) defects.push("revision");
  if (decision.headSha !== value.revision.headSha) defects.push("head");
  if (decision.role !== requirement.role) defects.push("role");
  if (decision.ownerUrn !== requirement.ownerUrn) defects.push("owner");
  if (decision.actorLogin !== expectedActor) defects.push("actor");
  if (!decision.externalId || !decision.url) defects.push("provenance");
  return defects;
}

export function inspectApprovalRequirement(
  value: ChangeCase,
  requirement: ApprovalRequirement,
  ownerMappings: OwnerMappingIndex = indexOwnerMappings(value),
): ApprovalRequirementInspection {
  const decisions = value.approvalDecisions.filter((decision) => decision.requirementKey === requirement.requirementKey);
  const collection = decisions.length === 0 ? "missing" : decisions.length === 1 ? "single" : "conflict";
  const expectedActor = ownerMappings.loginByOwner.get(requirement.ownerUrn);
  const records = decisions.map((decision) => {
    const defects = approvalDefects(value, requirement, decision, expectedActor);
    return { value: decision, defects, verified: collection === "single" && defects.length === 0 };
  });
  const record = records[0];
  let policyBlocker: ApprovalRequirementInspection["policyBlocker"];
  if (collection === "missing") policyBlocker = `APPROVAL_MISSING:${requirement.requirementKey}`;
  else if (collection === "conflict") policyBlocker = `APPROVAL_CONFLICT:${requirement.requirementKey}`;
  else if (record!.defects.some((defect) => defect !== "provenance")) {
    policyBlocker = `APPROVAL_UNVERIFIED:${requirement.requirementKey}`;
  } else if (record!.defects.includes("provenance")) {
    policyBlocker = `APPROVAL_PROVENANCE_MISSING:${requirement.requirementKey}`;
  } else if (record!.value.verdict === ApprovalVerdict.Reject) {
    policyBlocker = `APPROVAL_REJECTED:${requirement.requirementKey}`;
  }
  return {
    collection,
    ...(expectedActor === undefined ? {} : { expectedActor }),
    records,
    ...(record?.verified === true ? { verifiedDecision: record.value } : {}),
    ...(policyBlocker === undefined ? {} : { policyBlocker }),
  };
}
