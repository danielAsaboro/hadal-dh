import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { CasesService } from "../src/application/cases";
import { AtomicCaseReplica } from "../src/application/replica";
import { dataHubMcpConfigFromEnv, githubConfigFromEnv, parseCommand, productEnv, warnLegacyProductEnv } from "../src/config";
import { DataHubCaseStore } from "../src/datahub/case-store";
import { collectEvidence } from "../src/datahub/evidence";
import { DataHubMcpClient } from "../src/datahub/mcp-client";
import { GitHubApi } from "../src/github/api";
import { GitHubConnector } from "../src/github/connector";
import { generateCompatibilityMigration } from "../src/remediation/generate";
import { validateRemediation } from "../src/remediation/validate";
import { writeRemediationArtifacts } from "../src/remediation/write";
import { runValidation } from "../src/validation/runner";

const mappingSchema = z.array(z.tuple([
  z.string().startsWith("urn:li:"),
  z.string().regex(/^[A-Za-z0-9-]+$/),
])).min(1);
const boundedMilliseconds = z.coerce.number().int().min(1_000).max(900_000);

function required(suffix: string): string {
  const value = productEnv(process.env, suffix);
  if (!value) throw new Error(`CHANGEMARSHAL_${suffix} is required for the real governed demo`);
  return value;
}

warnLegacyProductEnv();
const repoRoot = resolve(required("DEMO_REPOSITORY_ROOT"));
const repository = required("GITHUB_REPOSITORY");
const baseRef = required("DEMO_BASE_REF");
const headRef = required("DEMO_HEAD_REF");
const targetUrl = required("DEMO_TARGET_URL");
const mappings = mappingSchema.parse(JSON.parse(required("DEMO_OWNER_MAPPINGS")) as unknown);
const validationCommand = parseCommand(required("DEMO_VALIDATION_COMMAND"));
const approvalTimeoutMs = boundedMilliseconds.parse(productEnv(process.env, "DEMO_APPROVAL_TIMEOUT_MS") ?? "300000");
const approvalPollMs = boundedMilliseconds.max(30_000).parse(productEnv(process.env, "DEMO_APPROVAL_POLL_MS") ?? "5000");
const replicaPath = resolve(productEnv(process.env, "CASE_REPLICA") ?? ".changemarshal/demo-case.json");

const client = await DataHubMcpClient.connect(dataHubMcpConfigFromEnv());
try {
  const store = new DataHubCaseStore(client);
  const service = new CasesService(
    { collect: async (change, maxHops) => await collectEvidence(client, change, maxHops) },
    store,
    new AtomicCaseReplica(replicaPath),
  );
  const github = githubConfigFromEnv();
  if (github.repository !== repository) throw new Error("GitHub and demo repository identities differ");
  const surface = new GitHubConnector(new GitHubApi({ token: github.token }), github.repository, github.pullNumber);

  const plannedAt = new Date().toISOString();
  let value = await service.plan({
    repoRoot,
    repository,
    baseRef,
    headRef,
    maxHops: 3,
    observedAt: plannedAt,
  });
  value = await service.updateOwnerMappings(value.caseKey, mappings, new Date().toISOString());
  value = await service.syncWork(value.caseKey, surface, new Date().toISOString());
  const firstIssueIds = value.externalProjections.map((item) => item.externalId).sort();

  const artifacts = generateCompatibilityMigration(value);
  const structural = validateRemediation(value, artifacts);
  if (!structural.valid) throw new Error(structural.errors.join("; "));
  await writeRemediationArtifacts(repoRoot, artifacts);
  for (const work of value.workItems) {
    const receipt = await runValidation({
      repoRoot,
      workKey: work.workKey,
      revisionKey: value.revision.revisionKey,
      headSha: value.revision.headSha,
      command: validationCommand,
      artifactPaths: artifacts.map((artifact) => artifact.relativePath),
      timeoutMs: 120_000,
    });
    if (!receipt.valid) throw new Error(`validation failed for work ${work.workKey}`);
    value = await service.recordReceipt(value.caseKey, receipt, new Date().toISOString());
  }

  const approvalDeadline = Date.now() + approvalTimeoutMs;
  while (true) {
    value = await service.reconcileWork(value.caseKey, surface, new Date().toISOString());
    const decided = new Set(value.approvalDecisions.map((decision) => decision.requirementKey));
    if (value.approvalRequirements.every((requirement) => decided.has(requirement.requirementKey))) break;
    if (Date.now() >= approvalDeadline) {
      const missing = value.approvalRequirements
        .filter((requirement) => !decided.has(requirement.requirementKey))
        .map((requirement) => requirement.requirementKey);
      throw new Error(`timed out waiting for real current-head GitHub reviews: ${missing.join(", ")}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, approvalPollMs));
  }

  value = await service.decide(
    value.caseKey,
    surface,
    targetUrl,
    value.revision.headSha,
    new Date().toISOString(),
  );
  if (value.admission?.allowed !== true || value.dataHub.verified !== true) {
    throw new Error(`deterministic admission remained blocked: ${value.admission?.blockers.join(", ")}`);
  }

  const rerunProjections = await surface.syncWork(value, new Date().toISOString());
  await surface.syncApprovalRequests(value);
  const secondIssueIds = rerunProjections.map((item) => item.externalId).sort();
  if (JSON.stringify(firstIssueIds) !== JSON.stringify(secondIssueIds)) {
    throw new Error("GitHub idempotency check changed issue identities");
  }
  const reread = await store.saveAndVerifyCase(value, value.dataHub.verifiedAt as string);
  if (reread.dataHub.documentUrn !== value.dataHub.documentUrn || reread.contentHash !== value.contentHash) {
    throw new Error("DataHub idempotency check changed document identity or content");
  }
  for (const artifact of artifacts) {
    await readFile(resolve(repoRoot, artifact.relativePath), "utf8");
  }

  process.stdout.write(`${JSON.stringify({
    caseKey: value.caseKey,
    revisionKey: value.revision.revisionKey,
    headSha: value.revision.headSha,
    dataHubDocumentUrn: value.dataHub.documentUrn,
    githubIssueIds: firstIssueIds,
    validationReceipts: value.validationReceipts.length,
    approvals: value.approvalDecisions.length,
    githubReviewIds: value.approvalDecisions.map((decision) => decision.externalId),
    admission: value.admission,
    idempotent: true,
  }, null, 2)}\n`);
} finally {
  await client.close();
}
