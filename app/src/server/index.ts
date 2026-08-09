import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";

import { CasesService } from "../application/cases";
import { AtomicCaseReplica } from "../application/replica";
import { dataHubMcpConfigFromEnv, githubConfigFromEnv, productEnv, warnLegacyProductEnv } from "../config";
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
const service = new CasesService(
  { collect: async (change, maxHops) => await collectEvidence(dataHub, change, maxHops) },
  store,
  replica,
);
const server = createServer({
  application: service,
  repoRoot: resolve(repoRoot),
  github: () => {
    const github = githubConfigFromEnv();
    return new GitHubConnector(new GitHubApi({ token: github.token }), github.repository, github.pullNumber);
  },
});
const distribution = resolve(fileURLToPath(new URL("../../dist", import.meta.url)));
await server.register(fastifyStatic, { root: distribution, wildcard: false });
server.addHook("onClose", async () => await dataHub.close());
const port = Number(productEnv(process.env, "PORT") ?? "4100");
await server.listen({ host: "127.0.0.1", port });
