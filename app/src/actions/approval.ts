import {
  ApprovalVerdict,
  ChangeCaseSchema,
  type ChangeCase,
} from "../domain/case";

export interface VerifiedActorSource {
  verifyActor(expectedLogin: string): Promise<Readonly<{ login: string; permission: string }>>;
}

export interface ApprovalInput {
  readonly requirementKey: string;
  readonly verdict: (typeof ApprovalVerdict)[keyof typeof ApprovalVerdict];
  readonly currentHeadSha: string;
  readonly decidedAt: string;
}

export class ApprovalRecordingError extends Error {
  override readonly name = "ApprovalRecordingError";
}

export async function recordApproval(
  value: ChangeCase,
  input: ApprovalInput,
  actors: VerifiedActorSource,
): Promise<ChangeCase> {
  if (input.currentHeadSha !== value.revision.headSha) {
    throw new ApprovalRecordingError("cannot approve a stale Git head SHA");
  }
  const requirement = value.approvalRequirements.find((item) =>
    item.requirementKey === input.requirementKey);
  if (requirement === undefined) throw new ApprovalRecordingError("approval requirement does not exist in this revision");
  const mappings = value.ownerMappings.filter(([owner]) => owner === requirement.ownerUrn);
  const logins = [...new Set(mappings.map(([, login]) => login))];
  if (logins.length !== 1) throw new ApprovalRecordingError("approval owner mapping is missing or ambiguous");
  const expectedLogin = logins[0] as string;
  const actor = await actors.verifyActor(expectedLogin);
  if (actor.login !== expectedLogin || !new Set(["write", "maintain", "admin"]).has(actor.permission)) {
    throw new ApprovalRecordingError("verified GitHub actor does not satisfy the governed owner mapping");
  }

  const existing = value.approvalDecisions.filter((decision) =>
    decision.requirementKey === requirement.requirementKey);
  if (existing.length > 1 || (existing[0] !== undefined && existing[0].verdict !== input.verdict)) {
    throw new ApprovalRecordingError("conflicting approval decision already exists");
  }
  const decision = {
    requirementKey: requirement.requirementKey,
    revisionKey: value.revision.revisionKey,
    headSha: value.revision.headSha,
    role: requirement.role,
    ownerUrn: requirement.ownerUrn,
    actorLogin: actor.login,
    verdict: input.verdict,
    decidedAt: input.decidedAt,
    source: "github" as const,
  };
  return ChangeCaseSchema.parse({
    ...value,
    approvalDecisions: existing.length === 1
      ? value.approvalDecisions
      : [...value.approvalDecisions, decision].sort((left, right) =>
          left.requirementKey.localeCompare(right.requirementKey)),
    dataHub: { verified: false },
    updatedAt: input.decidedAt,
    contentHash: undefined,
  });
}
