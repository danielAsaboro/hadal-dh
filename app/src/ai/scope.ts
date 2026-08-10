import type { ChangeCase } from "../domain/case";
import { resolveRevision } from "../git/repository";

export interface GovernedAgentGitScope {
  readonly repoRoot: string;
  readonly repository: string;
  readonly baseRef: string;
  readonly headRef: string;
}

export async function verifyGovernedAgentCaseScope(
  scope: GovernedAgentGitScope,
  value: ChangeCase,
): Promise<string> {
  if (value.repository !== scope.repository) {
    throw new Error("governed case repository does not match the QVAC agent scope");
  }
  const [baseSha, headSha, currentHeadSha] = await Promise.all([
    resolveRevision(scope.repoRoot, scope.baseRef),
    resolveRevision(scope.repoRoot, scope.headRef),
    resolveRevision(scope.repoRoot, "HEAD"),
  ]);
  if (value.revision.baseSha !== baseSha || value.revision.headSha !== headSha) {
    throw new Error("governed case revision does not match the QVAC agent scope");
  }
  if (currentHeadSha !== headSha) {
    throw new Error("repository HEAD changed after the governed QVAC scope was configured");
  }
  return currentHeadSha;
}
