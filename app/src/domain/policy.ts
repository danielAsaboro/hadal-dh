import { CaseState, type ChangeCase } from "./case";
import {
  indexOwnerMappings,
  inspectApprovalRequirement,
  inspectWorkProjection,
} from "./policy-evidence";

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

  const mappings = indexOwnerMappings(value);
  for (const work of value.workItems) {
    const login = mappings.loginByOwner.get(work.ownerUrn);
    if (login === undefined) blockers.add(`OWNER_MAPPING_MISSING:${work.ownerUrn}`);
    if (mappings.ambiguousOwners.has(work.ownerUrn)) blockers.add(`OWNER_MAPPING_AMBIGUOUS:${work.ownerUrn}`);

    const projection = inspectWorkProjection(value, work, mappings);
    if (projection.policyBlocker !== undefined) blockers.add(projection.policyBlocker);

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
    const approval = inspectApprovalRequirement(value, requirement, mappings);
    if (approval.policyBlocker !== undefined) blockers.add(approval.policyBlocker);
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
