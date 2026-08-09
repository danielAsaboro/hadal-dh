import {
  ApprovalVerdict,
  CaseState,
  ProjectionState,
  type ChangeCase,
} from "./case";

export interface PolicyObservations {
  readonly currentHeadSha: string;
  readonly evaluatedAt: string;
  readonly twoPhaseWritebackPending?: boolean;
}

export interface PolicyEvaluation {
  readonly state: ChangeCase["state"];
  readonly admission: NonNullable<ChangeCase["admission"]>;
}

function addOwnershipBlockers(value: ChangeCase, blockers: Set<string>): void {
  const required = new Set([
    value.evidence.source.urn,
    ...value.evidence.paths.map((path) => path.downstreamUrn),
  ]);
  const assets = new Map(value.evidence.assets.map((asset) => [asset.urn, asset]));
  for (const requiredUrn of [...required].sort()) {
    const asset = assets.get(requiredUrn);
    if (asset === undefined || asset.owners.length === 0) {
      blockers.add(`OWNERSHIP_MISSING:${requiredUrn}`);
    } else if (asset.owners.length !== 1) {
      blockers.add(`OWNERSHIP_AMBIGUOUS:${requiredUrn}`);
    }
  }
}

export function evaluateCase(
  value: ChangeCase,
  observations: PolicyObservations,
): PolicyEvaluation {
  const blockers = new Set<string>();
  if (!value.evidence.complete || value.evidence.assets.some((asset) => !asset.complete)) {
    blockers.add("CONTEXT_INCOMPLETE");
  }
  if (observations.currentHeadSha !== value.revision.headSha) blockers.add("HEAD_SHA_STALE");
  addOwnershipBlockers(value, blockers);

  const mappings = new Map<string, string>();
  const duplicateMappings = new Set<string>();
  for (const [owner, login] of value.ownerMappings) {
    if (mappings.has(owner) && mappings.get(owner) !== login) duplicateMappings.add(owner);
    mappings.set(owner, login);
  }
  for (const work of value.workItems) {
    const login = mappings.get(work.ownerUrn);
    if (login === undefined) blockers.add(`OWNER_MAPPING_MISSING:${work.ownerUrn}`);
    if (duplicateMappings.has(work.ownerUrn)) blockers.add(`OWNER_MAPPING_AMBIGUOUS:${work.ownerUrn}`);

    const projections = value.externalProjections.filter((projection) => projection.workKey === work.workKey);
    if (projections.length === 0) {
      blockers.add(`PROJECTION_MISSING:${work.workKey}`);
    } else if (
      projections.length !== 1
      || projections[0]?.state !== ProjectionState.Verified
      || projections[0].revisionKey !== value.revision.revisionKey
      || projections[0].headSha !== value.revision.headSha
      || projections[0].verifiedAt === null
      || projections[0].assignee !== login
    ) {
      blockers.add(`PROJECTION_UNVERIFIED:${work.workKey}`);
    }

    const receipts = value.validationReceipts.filter((receipt) => receipt.workKey === work.workKey);
    if (receipts.length === 0) {
      blockers.add(`VALIDATION_MISSING:${work.workKey}`);
    } else if (
      receipts.length !== 1
      || receipts[0]?.revisionKey !== value.revision.revisionKey
      || receipts[0].headSha !== value.revision.headSha
      || receipts[0].exitCode !== 0
      || !receipts[0].valid
    ) {
      blockers.add(`VALIDATION_FAILED:${work.workKey}`);
    }
  }

  for (const requirement of value.approvalRequirements) {
    const decisions = value.approvalDecisions.filter((decision) =>
      decision.requirementKey === requirement.requirementKey);
    if (decisions.length === 0) {
      blockers.add(`APPROVAL_MISSING:${requirement.requirementKey}`);
      continue;
    }
    if (decisions.length !== 1) {
      blockers.add(`APPROVAL_CONFLICT:${requirement.requirementKey}`);
      continue;
    }
    const decision = decisions[0];
    const expectedLogin = mappings.get(requirement.ownerUrn);
    if (
      decision?.revisionKey !== value.revision.revisionKey
      || decision.headSha !== value.revision.headSha
      || decision.role !== requirement.role
      || decision.ownerUrn !== requirement.ownerUrn
      || decision.actorLogin !== expectedLogin
    ) {
      blockers.add(`APPROVAL_UNVERIFIED:${requirement.requirementKey}`);
    } else if (decision.verdict === ApprovalVerdict.Reject) {
      blockers.add(`APPROVAL_REJECTED:${requirement.requirementKey}`);
    }
  }
  if (!value.dataHub.verified && observations.twoPhaseWritebackPending !== true) {
    blockers.add("DATAHUB_WRITEBACK_UNVERIFIED");
  }

  const ordered = [...blockers].sort();
  let state: ChangeCase["state"];
  if (blockers.has("HEAD_SHA_STALE")) state = CaseState.Stale;
  else if (blockers.has("CONTEXT_INCOMPLETE")) state = CaseState.BlockedContext;
  else if ([...blockers].some((code) => code.startsWith("OWNERSHIP_") || code.startsWith("OWNER_MAPPING_"))) {
    state = CaseState.BlockedOwnership;
  } else if ([...blockers].some((code) => code.startsWith("APPROVAL_"))) {
    state = CaseState.BlockedApproval;
  } else if ([...blockers].some((code) => code.startsWith("VALIDATION_"))) {
    state = CaseState.BlockedValidation;
  } else if (ordered.length === 1 && blockers.has("DATAHUB_WRITEBACK_UNVERIFIED")) {
    state = CaseState.Approved;
  } else if (ordered.length > 0) state = CaseState.InProgress;
  else state = CaseState.Ready;

  return {
    state,
    admission: {
      allowed: ordered.length === 0,
      blockers: ordered,
      revisionKey: value.revision.revisionKey,
      headSha: value.revision.headSha,
      evaluatedAt: observations.evaluatedAt,
    },
  };
}
