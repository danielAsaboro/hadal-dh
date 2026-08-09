import {
  ApprovalRole,
  CaseState,
  ChangeCaseSchema,
  WorkKind,
  type ChangeCase,
  type DbtColumnRename,
  type ImpactEvidence,
} from "./case";
import {
  approvalRequirementKey,
  caseKey,
  revisionKey,
  workKey,
} from "./identity";
import { canonicalValueHash } from "./serialization";

export interface GitCaseContext {
  readonly repository: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly observedAt: string;
  readonly change: DbtColumnRename;
}

type WorkItem = ChangeCase["workItems"][number];
type ApprovalRequirement = ChangeCase["approvalRequirements"][number];

function ownerFor(
  asset: ImpactEvidence["assets"][number] | undefined,
): string | undefined {
  return asset?.complete === true && asset.owners.length === 1
    ? asset.owners[0]
    : undefined;
}

function hasOwnershipProblems(evidence: ImpactEvidence): boolean {
  const required = new Set([
    evidence.source.urn,
    ...evidence.paths.map((path) => path.downstreamUrn),
  ]);
  const assets = new Map(evidence.assets.map((asset) => [asset.urn, asset]));
  return [...required].some((urn) => ownerFor(assets.get(urn)) === undefined);
}

function workTitle(kind: WorkItem["kind"], count: number): string {
  if (kind === WorkKind.ProducerMigration) return "Implement compatible producer migration";
  if (kind === WorkKind.MlValidation) return `Validate ${count} affected ML consumer${count === 1 ? "" : "s"}`;
  return `Remediate ${count} affected data consumer${count === 1 ? "" : "s"}`;
}

function completionCriteria(kind: WorkItem["kind"], headSha: string): readonly string[] {
  if (kind === WorkKind.ProducerMigration) {
    return [
      "Add a compatibility alias for the renamed column",
      "Update dbt schema tests for the compatibility contract",
      `Record a successful validation receipt for Git head ${headSha}`,
    ];
  }
  if (kind === WorkKind.MlValidation) {
    return [
      "Run the configured ML consumer validation",
      `Record output and artifact hashes for Git head ${headSha}`,
    ];
  }
  return [
    "Update or verify every listed consumer against the compatibility contract",
    `Record a successful validation receipt for Git head ${headSha}`,
  ];
}

function deriveWork(
  evidence: ImpactEvidence,
  logicalCaseKey: string,
  currentRevisionKey: string,
  headSha: string,
): readonly WorkItem[] {
  if (!evidence.complete) return [];
  const assets = new Map(evidence.assets.map((asset) => [asset.urn, asset]));
  const groups = new Map<string, {
    kind: WorkItem["kind"];
    ownerUrn: string;
    affected: Set<string>;
    indexes: Set<number>;
  }>();
  const add = (kind: WorkItem["kind"], ownerUrn: string, affectedUrn: string, indexes: readonly number[]) => {
    const key = `${kind}\0${ownerUrn}`;
    const group = groups.get(key) ?? {
      kind,
      ownerUrn,
      affected: new Set<string>(),
      indexes: new Set<number>(),
    };
    group.affected.add(affectedUrn);
    for (const index of indexes) group.indexes.add(index);
    groups.set(key, group);
  };

  const sourceOwner = ownerFor(assets.get(evidence.source.urn));
  if (sourceOwner !== undefined) add(WorkKind.ProducerMigration, sourceOwner, evidence.source.urn, []);
  const downstreamUrns = [...new Set(evidence.paths.map((path) => path.downstreamUrn))].sort();
  for (const affectedUrn of downstreamUrns) {
    const asset = assets.get(affectedUrn);
    const owner = ownerFor(asset);
    if (owner === undefined || asset === undefined) continue;
    const kind = ["mlModel", "mlFeature"].includes(asset.type)
      ? WorkKind.MlValidation
      : WorkKind.ConsumerAcknowledgement;
    const indexes = evidence.paths.flatMap((path, index) =>
      path.downstreamUrn === affectedUrn ? [index] : []);
    add(kind, owner, affectedUrn, indexes);
  }

  return [...groups.values()].map((group) => {
    const affectedUrns = [...group.affected].sort();
    return {
      workKey: workKey(logicalCaseKey, group.ownerUrn, group.kind, affectedUrns),
      revisionKey: currentRevisionKey,
      kind: group.kind,
      ownerUrn: group.ownerUrn,
      affectedUrns,
      lineagePathIndexes: [...group.indexes].sort((left, right) => left - right),
      title: workTitle(group.kind, affectedUrns.length),
      completionCriteria: completionCriteria(group.kind, headSha),
    };
  }).sort((left, right) => left.workKey.localeCompare(right.workKey));
}

function deriveApprovals(
  evidence: ImpactEvidence,
  logicalCaseKey: string,
  currentRevisionKey: string,
): readonly ApprovalRequirement[] {
  if (!evidence.complete) return [];
  const assets = new Map(evidence.assets.map((asset) => [asset.urn, asset]));
  const groups = new Map<string, { role: ApprovalRequirement["role"]; owner: string; affected: Set<string> }>();
  const add = (role: ApprovalRequirement["role"], owner: string, affectedUrn: string) => {
    const key = `${role}\0${owner}`;
    const group = groups.get(key) ?? { role, owner, affected: new Set<string>() };
    group.affected.add(affectedUrn);
    groups.set(key, group);
  };
  const sourceOwner = ownerFor(assets.get(evidence.source.urn));
  if (sourceOwner !== undefined) add(ApprovalRole.Producer, sourceOwner, evidence.source.urn);
  for (const affectedUrn of [...new Set(evidence.paths.map((path) => path.downstreamUrn))].sort()) {
    const owner = ownerFor(assets.get(affectedUrn));
    if (owner !== undefined) add(ApprovalRole.Consumer, owner, affectedUrn);
  }
  return [...groups.values()].map((group) => {
    const affectedUrns = [...group.affected].sort();
    return {
      requirementKey: approvalRequirementKey(logicalCaseKey, group.role, group.owner, affectedUrns),
      revisionKey: currentRevisionKey,
      role: group.role,
      ownerUrn: group.owner,
      affectedUrns,
    };
  }).sort((left, right) => left.requirementKey.localeCompare(right.requirementKey));
}

export function compileCase(
  evidence: ImpactEvidence,
  git: GitCaseContext,
  existing?: ChangeCase,
): ChangeCase {
  const fingerprint = canonicalValueHash(evidence);
  const logicalCaseKey = caseKey(git.repository, evidence.source.urn, git.change);
  const currentRevisionKey = revisionKey(
    logicalCaseKey,
    git.baseSha,
    git.headSha,
    fingerprint,
  );
  const sameLogicalCase = existing?.caseKey === logicalCaseKey;
  const sameRevision = sameLogicalCase && existing.revision.revisionKey === currentRevisionKey;
  const workItems = deriveWork(evidence, logicalCaseKey, currentRevisionKey, git.headSha);
  const approvalRequirements = deriveApprovals(evidence, logicalCaseKey, currentRevisionKey);
  const initialState = !evidence.complete
    ? CaseState.BlockedContext
    : hasOwnershipProblems(evidence)
      ? CaseState.BlockedOwnership
      : CaseState.Planned;

  return ChangeCaseSchema.parse({
    schemaVersion: 1,
    caseKey: logicalCaseKey,
    repository: git.repository,
    change: git.change,
    evidence,
    revision: {
      revisionKey: currentRevisionKey,
      baseSha: git.baseSha,
      headSha: git.headSha,
      evidenceFingerprint: fingerprint,
      createdAt: sameRevision ? existing.revision.createdAt : git.observedAt,
    },
    state: sameRevision ? existing.state : initialState,
    workItems,
    approvalRequirements,
    approvalDecisions: sameRevision ? existing.approvalDecisions : [],
    validationReceipts: sameRevision ? existing.validationReceipts : [],
    externalProjections: sameRevision ? existing.externalProjections : [],
    ...(sameRevision && existing.admission !== undefined ? { admission: existing.admission } : {}),
    ownerMappings: sameLogicalCase ? existing.ownerMappings : [],
    dataHub: sameRevision ? existing.dataHub : { verified: false },
    createdAt: sameLogicalCase ? existing.createdAt : git.observedAt,
    updatedAt: git.observedAt,
  });
}
