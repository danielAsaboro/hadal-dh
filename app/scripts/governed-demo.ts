import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { CasesService } from "../src/application/cases";
import { AtomicCaseReplica } from "../src/application/replica";
import { dataHubMcpConfigFromEnv, githubConfigFromEnv, parseCommand } from "../src/config";
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

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the real governed demo`);
  return value;
}

const repoRoot = resolve(required("CUTSET_DEMO_REPOSITORY_ROOT"));
const repository = required("CUTSET_GITHUB_REPOSITORY");
const baseRef = required("CUTSET_DEMO_BASE_REF");
const headRef = required("CUTSET_DEMO_HEAD_REF");
const targetUrl = required("CUTSET_DEMO_TARGET_URL");
const mappings = mappingSchema.parse(JSON.parse(required("CUTSET_DEMO_OWNER_MAPPINGS")) as unknown);
const validationCommand = parseCommand(required("CUTSET_DEMO_VALIDATION_COMMAND"));
const replicaPath = resolve(process.env.CUTSET_CASE_REPLICA ?? ".cutset/demo-case.json");

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

  for (const requirement of value.approvalRequirements) {
    value = await service.approve(value.caseKey, {
      requirementKey: requirement.requirementKey,
      verdict: "approve",
      currentHeadSha: value.revision.headSha,
      decidedAt: new Date().toISOString(),
    }, surface);
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
    admission: value.admission,
    idempotent: true,
  }, null, 2)}\n`);
} finally {
  await client.close();
}
