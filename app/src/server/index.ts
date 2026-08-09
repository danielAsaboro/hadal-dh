import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";

import { CasesService } from "../application/cases";
import { AtomicCaseReplica } from "../application/replica";
import { dataHubMcpConfigFromEnv, githubConfigFromEnv } from "../config";
import { DataHubCaseStore } from "../datahub/case-store";
import { collectEvidence } from "../datahub/evidence";
import { DataHubMcpClient } from "../datahub/mcp-client";
import { GitHubApi } from "../github/api";
import { GitHubConnector } from "../github/connector";
import { createServer } from "./app";

const repoRoot = process.env.CUTSET_REPOSITORY_ROOT;
if (!repoRoot) throw new Error("CUTSET_REPOSITORY_ROOT is required");
const github = githubConfigFromEnv();
const dataHub = await DataHubMcpClient.connect(dataHubMcpConfigFromEnv());
const store = new DataHubCaseStore(dataHub);
const replica = new AtomicCaseReplica(resolve(process.env.CUTSET_CASE_REPLICA ?? ".cutset/case.json"));
const service = new CasesService(
  { collect: async (change, maxHops) => await collectEvidence(dataHub, change, maxHops) },
  store,
  replica,
);
const server = createServer({
  application: service,
  repoRoot: resolve(repoRoot),
  github: () => new GitHubConnector(new GitHubApi({ token: github.token }), github.repository, github.pullNumber),
});
const distribution = resolve(fileURLToPath(new URL("../../dist", import.meta.url)));
await server.register(fastifyStatic, { root: distribution, wildcard: false });
server.get("/", async (_request, reply) => await reply.sendFile("index.html"));
server.get("/assets/*", async (request, reply) => {
  const path = (request.params as { "*": string })["*"];
  return await reply.sendFile(path, resolve(distribution, "assets"));
});
server.addHook("onClose", async () => await dataHub.close());
const port = Number(process.env.CUTSET_PORT ?? "4100");
await server.listen({ host: "127.0.0.1", port });
