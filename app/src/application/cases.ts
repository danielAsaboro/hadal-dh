import type {
  ChangeCase,
  DbtColumnRename,
  ImpactEvidence,
  ValidationReceipt,
} from "../domain/case";
import { ChangeCaseSchema } from "../domain/case";
import { compileCase } from "../domain/compile-case";
import { evaluateCase } from "../domain/policy";
import {
  recordApproval,
  type ApprovalInput,
  type VerifiedActorSource,
} from "../actions/approval";
import { detectColumnRename } from "../git/dbt-change";
import { readDiff, resolveRevision } from "../git/repository";
import type { CaseReplica } from "./replica";

export interface EvidenceSource {
  collect(change: DbtColumnRename, maxHops: number): Promise<ImpactEvidence>;
}

export interface CaseStore {
  findCase(caseKey: string): Promise<string | undefined>;
  loadCase(documentUrn: string): Promise<ChangeCase>;
  saveAndVerifyCase(value: ChangeCase, verifiedAt: string): Promise<ChangeCase>;
  listCases?(): Promise<readonly ChangeCase[]>;
}

export interface WorkSurface {
  syncWork(value: ChangeCase, verifiedAt: string): Promise<ChangeCase["externalProjections"]>;
  reconcileWork(value: ChangeCase, verifiedAt: string): Promise<ChangeCase["externalProjections"]>;
}

export interface StatusSurface {
  publishAndVerifyStatus(headSha: string, allowed: boolean, targetUrl: string): Promise<void>;
}

export interface PlanInput {
  readonly repoRoot: string;
  readonly repository: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly maxHops: number;
  readonly observedAt: string;
}

export class CasesServiceError extends Error {
  override readonly name = "CasesServiceError";
}

function unverified(value: ChangeCase, updatedAt: string): ChangeCase {
  const { contentHash: _contentHash, ...content } = value;
  return ChangeCaseSchema.parse({
    ...content,
    dataHub: { verified: false },
    updatedAt,
  });
}

export class CasesService {
  constructor(
    private readonly evidence: EvidenceSource,
    private readonly store: CaseStore,
    private readonly replica?: CaseReplica,
  ) {}

  private async load(caseKey: string): Promise<ChangeCase> {
    const documentUrn = await this.store.findCase(caseKey);
    if (documentUrn === undefined) throw new CasesServiceError(`governed case does not exist: ${caseKey}`);
    return await this.store.loadCase(documentUrn);
  }

  private async persist(value: ChangeCase, currentHeadSha: string, at: string): Promise<ChangeCase> {
    const evaluation = evaluateCase(value, {
      currentHeadSha,
      evaluatedAt: at,
      twoPhaseWritebackPending: true,
    });
    const governed = unverified({
      ...value,
      state: evaluation.state,
      admission: evaluation.admission,
    }, at);
    const verified = await this.store.saveAndVerifyCase(governed, at);
    const confirmed = evaluateCase(verified, { currentHeadSha, evaluatedAt: at });
    if (
      confirmed.state !== verified.state
      || confirmed.admission.allowed !== verified.admission?.allowed
      || JSON.stringify(confirmed.admission.blockers) !== JSON.stringify(verified.admission?.blockers)
    ) {
      throw new CasesServiceError("DataHub-reread case does not match deterministic policy");
    }
    await this.replica?.save(verified);
    return verified;
  }

  async plan(input: PlanInput): Promise<ChangeCase> {
    try {
      const baseSha = await resolveRevision(input.repoRoot, input.baseRef);
      const headSha = await resolveRevision(input.repoRoot, input.headRef);
      const change = detectColumnRename(await readDiff(input.repoRoot, baseSha, headSha));
      const evidence = await this.evidence.collect(change, input.maxHops);
      const initial = compileCase(evidence, {
        repository: input.repository,
        baseSha,
        headSha,
        observedAt: input.observedAt,
        change,
      });
      const existingUrn = await this.store.findCase(initial.caseKey);
      const existing = existingUrn === undefined ? undefined : await this.store.loadCase(existingUrn);
      const compiled = compileCase(evidence, {
        repository: input.repository,
        baseSha,
        headSha,
        observedAt: input.observedAt,
        change,
      }, existing);
      return await this.persist(unverified(compiled, input.observedAt), headSha, input.observedAt);
    } catch (error) {
      if (error instanceof CasesServiceError) throw error;
      throw new CasesServiceError("could not plan governed change case", { cause: error });
    }
  }

  async show(caseKey: string): Promise<ChangeCase> {
    return await this.load(caseKey);
  }

  async list(): Promise<readonly ChangeCase[]> {
    if (this.store.listCases === undefined) throw new CasesServiceError("case store does not support governed case indexing");
    return await this.store.listCases();
  }

  async syncWork(caseKey: string, surface: WorkSurface, at: string): Promise<ChangeCase> {
    try {
      const current = await this.load(caseKey);
      if (!current.evidence.complete || current.evidence.assets.some((asset) => !asset.complete)) {
        throw new CasesServiceError("complete DataHub evidence is required before external work");
      }
      const projections = await surface.syncWork(current, at);
      return await this.persist(unverified({ ...current, externalProjections: projections }, at), current.revision.headSha, at);
    } catch (error) {
      if (error instanceof CasesServiceError) throw error;
      throw new CasesServiceError("could not synchronize external work", { cause: error });
    }
  }

  async reconcileWork(caseKey: string, surface: WorkSurface, at: string): Promise<ChangeCase> {
    try {
      const current = await this.load(caseKey);
      const projections = await surface.reconcileWork(current, at);
      return await this.persist(unverified({ ...current, externalProjections: projections }, at), current.revision.headSha, at);
    } catch (error) {
      throw new CasesServiceError("could not reconcile external work", { cause: error });
    }
  }

  async updateOwnerMappings(
    caseKey: string,
    mappings: readonly [string, string][],
    at: string,
  ): Promise<ChangeCase> {
    const current = await this.load(caseKey);
    const normalized = [...mappings].sort(([left], [right]) => left.localeCompare(right));
    return await this.persist(unverified({ ...current, ownerMappings: normalized }, at), current.revision.headSha, at);
  }

  async recordReceipt(caseKey: string, receipt: ValidationReceipt, at: string): Promise<ChangeCase> {
    const current = await this.load(caseKey);
    const work = current.workItems.find((item) => item.workKey === receipt.workKey);
    if (
      work === undefined
      || receipt.revisionKey !== current.revision.revisionKey
      || receipt.headSha !== current.revision.headSha
    ) {
      throw new CasesServiceError("validation receipt does not match current required work");
    }
    const receipts = [
      ...current.validationReceipts.filter((item) => item.workKey !== receipt.workKey),
      receipt,
    ].sort((left, right) => left.workKey.localeCompare(right.workKey));
    return await this.persist(unverified({ ...current, validationReceipts: receipts }, at), current.revision.headSha, at);
  }

  async approve(
    caseKey: string,
    input: ApprovalInput,
    actors: VerifiedActorSource,
  ): Promise<ChangeCase> {
    try {
      const current = await this.load(caseKey);
      const approved = await recordApproval(current, input, actors);
      return await this.persist(approved, input.currentHeadSha, input.decidedAt);
    } catch (error) {
      throw new CasesServiceError("could not record governed approval", { cause: error });
    }
  }

  async decide(
    caseKey: string,
    surface: StatusSurface,
    targetUrl: string,
    currentHeadSha: string,
    at: string,
  ): Promise<ChangeCase> {
    const current = await this.load(caseKey);
    const persisted = await this.persist(unverified(current, at), currentHeadSha, at);
    const evaluation = evaluateCase(persisted, { currentHeadSha, evaluatedAt: at });
    if (evaluation.admission.allowed !== persisted.admission?.allowed) {
      throw new CasesServiceError("persisted admission does not match deterministic policy");
    }
    await surface.publishAndVerifyStatus(currentHeadSha, evaluation.admission.allowed, targetUrl);
    return persisted;
  }
}
