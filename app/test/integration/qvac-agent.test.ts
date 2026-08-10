import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { createAgentOperations } from "../../src/ai/operations";
import { createChangeMarshalAgent } from "../../src/ai/orchestrator";
import { createQvacModel } from "../../src/ai/qvac";
import { AgentRunCoordinator } from "../../src/ai/run-coordinator";
import { adaptChangeMarshalAgent, GovernedAgentRunService } from "../../src/ai/run-service";
import { CasesService, type StatusSurface, type WorkSurface } from "../../src/application/cases";
import { dataHubMcpConfigFromEnv, productEnv, qvacConfigFromEnv } from "../../src/config";
import { DataHubCaseStore } from "../../src/datahub/case-store";
import { collectEvidence } from "../../src/datahub/evidence";
import { DataHubMcpClient } from "../../src/datahub/mcp-client";
import { resolveRevision } from "../../src/git/repository";

const execute = promisify(execFile);
const live = productEnv(process.env, "QVAC_AGENT_LIVE") === "1";

const forbiddenGitHub: WorkSurface & StatusSurface = {
  syncWork: async () => { throw new Error("QVAC remediation proof attempted GitHub mutation"); },
  reconcileWork: async () => { throw new Error("QVAC remediation proof attempted GitHub mutation"); },
  syncApprovalRequests: async () => { throw new Error("QVAC remediation proof attempted GitHub mutation"); },
  reconcileApprovals: async () => { throw new Error("QVAC remediation proof attempted GitHub mutation"); },
  publishAndVerifyStatus: async () => { throw new Error("QVAC remediation proof attempted GitHub mutation"); },
};

(live ? it : it.skip)("runs a real QVAC ToolLoopAgent through approval-gated remediation", async () => {
  const sourceRepo = productEnv(process.env, "AGENT_REPOSITORY_ROOT");
  const baseRef = productEnv(process.env, "AGENT_BASE_REF");
  const headRef = productEnv(process.env, "AGENT_HEAD_REF");
  if (!sourceRepo || !baseRef || !headRef) throw new Error("live QVAC Git scope is incomplete");

  const temp = await mkdtemp(join(tmpdir(), "changemarshal-qvac-live-"));
  const repoRoot = join(temp, "repository");
  const dataHub = await DataHubMcpClient.connect(dataHubMcpConfigFromEnv());
  let qvac: Awaited<ReturnType<typeof createQvacModel>> | undefined;
  try {
    await execute("git", ["clone", "--quiet", sourceRepo, repoRoot]);
    const evidence = { collect: async (change: Parameters<typeof collectEvidence>[1], maxHops: number) =>
      await collectEvidence(dataHub, change, maxHops) };
    const service = new CasesService(evidence, new DataHubCaseStore(dataHub));
    const scope = {
      repoRoot,
      repository: "change-marshal/live-qvac-approval-proof",
      baseRef,
      headRef,
      targetUrl: "https://example.invalid/change-marshal/qvac-proof",
      maxHops: 3,
      ownerMappings: [],
      validationCommand: [],
      artifactPaths: [],
    };
    const value = await service.plan({
      repoRoot, repository: scope.repository, baseRef, headRef, maxHops: 3,
      observedAt: "2026-08-10T00:00:00.000Z",
    });
    qvac = await createQvacModel(qvacConfigFromEnv());
    const agent = createChangeMarshalAgent({
      model: qvac.model,
      scope,
      operations: createAgentOperations({
        scope, evidence, service, workSurface: forbiddenGitHub, statusSurface: forbiddenGitHub,
      }),
    });
    const runs = new GovernedAgentRunService({
      coordinator: new AgentRunCoordinator(),
      generator: adaptChangeMarshalAgent(agent),
      modelId: qvac.modelId,
      managed: qvac.managed,
    });

    const pending = await runs.start({
      caseKey: value.caseKey,
      headSha: value.revision.headSha,
      prompt: `Call readCase for ${value.caseKey}. Then call generateRemediation for that exact case once. Do not call any other mutating tool. After its verified result, summarize and stop.`,
    });
    expect(pending.status).toBe("waiting_for_approval");
    expect(pending.pendingApproval?.toolName).toBe("generateRemediation");

    const headSha = await resolveRevision(repoRoot, "HEAD");
    const completed = await runs.resolveApproval({
      runId: pending.runId,
      token: pending.pendingApproval?.token as string,
      currentHeadSha: headSha,
      approved: true,
      reason: "Live QVAC remediation proof",
    });
    expect(completed.status).toBe("completed");
    expect(completed.events.some((event) => event.kind === "tool_approved")).toBe(true);
    expect(completed.events.some((event) => event.kind === "tool_completed" && event.toolName === "generateRemediation")).toBe(true);
    expect(await readFile(join(repoRoot, ".changemarshal/remediation/customers_compatibility.sql"), "utf8"))
      .toContain("email_address");
  } finally {
    if (qvac !== undefined) await qvac.close();
    await dataHub.close();
    await rm(temp, { recursive: true, force: true });
  }
}, 45 * 60_000);
