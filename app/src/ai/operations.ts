import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { EvidenceSource, StatusSurface, WorkSurface } from "../application/cases";
import { CasesService } from "../application/cases";
import type { ChangeCase } from "../domain/case";
import { detectColumnRename } from "../git/dbt-change";
import { readDiff, resolveRevision } from "../git/repository";
import { generateCompatibilityMigration, RemediationGenerationError } from "../remediation/generate";
import { validateRemediation } from "../remediation/validate";
import { writeRemediationArtifacts } from "../remediation/write";
import { runValidation, ValidationRunnerError } from "../validation/runner";
import type { AgentOperations, AgentScope } from "./orchestrator";
import { verifyGovernedAgentCaseScope } from "./scope";

type Dependencies = Readonly<{
  scope: AgentScope;
  evidence: EvidenceSource;
  service: CasesService;
  workSurface: WorkSurface;
  statusSurface: StatusSurface;
  now?: () => string;
}>;

export function agentCaseContext(value: ChangeCase) {
  const { agentRuns, contentHash: _contentHash, ...current } = value;
  return {
    ...current,
    audit: {
      priorRunCount: agentRuns.length,
      ...(agentRuns.at(-1) === undefined ? {} : { latestRunStatus: agentRuns.at(-1)?.status }),
    },
  };
}

export function createAgentOperations(dependencies: Dependencies): AgentOperations {
  const now = dependencies.now ?? (() => new Date().toISOString());

  async function gitChange() {
    const baseSha = await resolveRevision(dependencies.scope.repoRoot, dependencies.scope.baseRef);
    const headSha = await resolveRevision(dependencies.scope.repoRoot, dependencies.scope.headRef);
    const change = detectColumnRename(await readDiff(dependencies.scope.repoRoot, baseSha, headSha));
    return { baseSha, headSha, change };
  }

  async function governedCase(caseKey: string): Promise<ChangeCase> {
    const value = await dependencies.service.show(caseKey);
    await verifyGovernedAgentCaseScope(dependencies.scope, value);
    return value;
  }

  return {
    inspectGitChange: async () => await gitChange(),
    inspectDataHubImpact: async () => {
      const { baseSha, headSha, change } = await gitChange();
      const evidence = await dependencies.evidence.collect(change, dependencies.scope.maxHops);
      return { baseSha, headSha, change, evidence };
    },
    planChangeCase: async () => await dependencies.service.plan({
      repoRoot: dependencies.scope.repoRoot,
      repository: dependencies.scope.repository,
      baseRef: dependencies.scope.baseRef,
      headRef: dependencies.scope.headRef,
      maxHops: dependencies.scope.maxHops,
      observedAt: now(),
    }),
    readCase: async (caseKey) => agentCaseContext(await governedCase(caseKey)),
    mapOwners: async (caseKey) => {
      await governedCase(caseKey);
      if (dependencies.scope.ownerMappings.length === 0) {
        throw new Error("operator-configured owner mappings are required");
      }
      return await dependencies.service.updateOwnerMappings(
        caseKey,
        dependencies.scope.ownerMappings.map(([owner, login]) => [owner, login]),
        now(),
      );
    },
    syncGitHubWork: async (caseKey) => {
      await governedCase(caseKey);
      return await dependencies.service.syncWork(caseKey, dependencies.workSurface, now());
    },
    generateRemediation: async (caseKey) => {
      const value = await governedCase(caseKey);
      const artifacts = generateCompatibilityMigration(value);
      const structural = validateRemediation(value, artifacts);
      if (!structural.valid) throw new RemediationGenerationError(structural.errors.join("; "));
      const written = await writeRemediationArtifacts(dependencies.scope.repoRoot, artifacts);
      return { valid: true, written, artifacts: artifacts.map((artifact) => artifact.relativePath) };
    },
    validateWork: async (caseKey, workKey) => {
      if (dependencies.scope.validationCommand.length === 0 || dependencies.scope.artifactPaths.length === 0) {
        throw new ValidationRunnerError("operator-configured validation command and artifacts are required");
      }
      const value = await governedCase(caseKey);
      const expected = generateCompatibilityMigration(value);
      const actual = await Promise.all(expected.map(async (artifact) => ({
        relativePath: artifact.relativePath,
        content: await readFile(resolve(dependencies.scope.repoRoot, artifact.relativePath), "utf8"),
      })));
      const structural = validateRemediation(value, actual);
      if (!structural.valid) throw new ValidationRunnerError(structural.errors.join("; "));
      const receipt = await runValidation({
        repoRoot: dependencies.scope.repoRoot,
        workKey,
        revisionKey: value.revision.revisionKey,
        headSha: value.revision.headSha,
        command: dependencies.scope.validationCommand,
        artifactPaths: dependencies.scope.artifactPaths,
        timeoutMs: 120_000,
      });
      return await dependencies.service.recordReceipt(caseKey, receipt, now());
    },
    reconcileGitHubWork: async (caseKey) => {
      await governedCase(caseKey);
      return await dependencies.service.reconcileWork(caseKey, dependencies.workSurface, now());
    },
    publishMergeDecision: async (caseKey) => {
      const currentHeadSha = await verifyGovernedAgentCaseScope(
        dependencies.scope,
        await dependencies.service.show(caseKey),
      );
      const value = await dependencies.service.decide(
        caseKey,
        dependencies.statusSurface,
        dependencies.scope.targetUrl,
        currentHeadSha,
        now(),
      );
      return { caseKey: value.caseKey, state: value.state, admission: value.admission, dataHub: value.dataHub };
    },
  };
}
