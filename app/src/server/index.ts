import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";

import { createAgentOperations } from "../ai/operations";
import { createChangeMarshalAgent } from "../ai/orchestrator";
import { createQvacModel, type QvacModelHandle } from "../ai/qvac";
import { AgentRunCoordinator } from "../ai/run-coordinator";
import { adaptChangeMarshalAgent, GovernedAgentRunService } from "../ai/run-service";
import { toDurableAgentRun } from "../ai/run-events";
import { CasesService } from "../application/cases";
import { AtomicCaseReplica } from "../application/replica";
import { agentScopeFromEnv, dataHubMcpConfigFromEnv, githubConfigFromEnv, productEnv, qvacConfigFromEnv, warnLegacyProductEnv } from "../config";
import { DataHubCaseStore } from "../datahub/case-store";
import { collectEvidence } from "../datahub/evidence";
import { DataHubMcpClient } from "../datahub/mcp-client";
import { GitHubApi } from "../github/api";
import { GitHubConnector } from "../github/connector";
import { createServer } from "./app";

warnLegacyProductEnv();
const repoRoot = productEnv(process.env, "REPOSITORY_ROOT");
if (!repoRoot) throw new Error("CHANGEMARSHAL_REPOSITORY_ROOT is required (legacy CUTSET_REPOSITORY_ROOT is accepted)");
const dataHub = await DataHubMcpClient.connect(dataHubMcpConfigFromEnv());
const store = new DataHubCaseStore(dataHub);
const replica = new AtomicCaseReplica(resolve(productEnv(process.env, "CASE_REPLICA") ?? ".changemarshal/case.json"));
const evidence = { collect: async (change: Parameters<typeof collectEvidence>[1], maxHops: number) => await collectEvidence(dataHub, change, maxHops) };
const service = new CasesService(
  evidence,
  store,
  replica,
);
const repositoryRoot = resolve(repoRoot);
const connector = () => {
  const github = githubConfigFromEnv();
  return new GitHubConnector(new GitHubApi({ token: github.token }), github.repository, github.pullNumber);
};
const githubSurface = {
  syncWork: async (...args: Parameters<GitHubConnector["syncWork"]>) => await connector().syncWork(...args),
  reconcileWork: async (...args: Parameters<GitHubConnector["reconcileWork"]>) => await connector().reconcileWork(...args),
  syncApprovalRequests: async (...args: Parameters<GitHubConnector["syncApprovalRequests"]>) => await connector().syncApprovalRequests(...args),
  reconcileApprovals: async (...args: Parameters<GitHubConnector["reconcileApprovals"]>) => await connector().reconcileApprovals(...args),
  publishAndVerifyStatus: async (...args: Parameters<GitHubConnector["publishAndVerifyStatus"]>) => await connector().publishAndVerifyStatus(...args),
};
let qvac: QvacModelHandle | undefined;
let agentRun: GovernedAgentRunService | undefined;
let agentScope: ReturnType<typeof agentScopeFromEnv> | undefined;
if (productEnv(process.env, "AGENT_ENABLED") === "1") {
  try {
    const scope = agentScopeFromEnv(repositoryRoot);
    agentScope = scope;
    qvac = await createQvacModel(qvacConfigFromEnv());
    const agent = createChangeMarshalAgent({
      model: qvac.model,
      scope,
      operations: createAgentOperations({
        scope,
        evidence,
        service,
        workSurface: githubSurface,
        statusSurface: githubSurface,
      }),
    });
    agentRun = new GovernedAgentRunService({
      coordinator: new AgentRunCoordinator(),
      generator: adaptChangeMarshalAgent(agent),
      modelId: qvac.modelId,
      managed: qvac.managed,
      persist: async (snapshot) => {
        const current = await service.show(snapshot.caseKey);
        const run = toDurableAgentRun(snapshot, current.revision.revisionKey);
        await service.recordAgentRun(snapshot.caseKey, run, run.updatedAt);
      },
    });
  } catch (error) {
    if (qvac !== undefined) await qvac.close();
    await dataHub.close();
    throw error;
  }
}
const server = createServer({
  application: service,
  repoRoot: repositoryRoot,
  github: connector,
  ...(agentRun === undefined || agentScope === undefined ? {} : { agent: agentRun, agentScope }),
});
const distribution = resolve(fileURLToPath(new URL("../../dist", import.meta.url)));
await server.register(fastifyStatic, { root: distribution, wildcard: false });
server.addHook("onClose", async () => {
  if (qvac !== undefined) await qvac.close();
  await dataHub.close();
});
const port = Number(productEnv(process.env, "PORT") ?? "4100");
await server.listen({ host: "127.0.0.1", port });
