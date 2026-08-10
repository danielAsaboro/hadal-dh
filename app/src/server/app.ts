import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { CasesService, StatusSurface, WorkSurface } from "../application/cases";
import type { AgentRunSnapshot } from "../ai/run-events";
import { REMEDIATION_AGENT_TOOL_SEQUENCE, type AgentToolName } from "../ai/orchestrator";
import { verifyGovernedAgentCaseScope } from "../ai/scope";
import type { ChangeCase, ValidationReceipt } from "../domain/case";
import { resolveRevision } from "../git/repository";
import { generateCompatibilityMigration } from "../remediation/generate";
import { validateRemediation } from "../remediation/validate";
import { writeRemediationArtifacts } from "../remediation/write";
import { registerUiStaticRoutes } from "../ui/static-routes";
import { runValidation, ValidationRunnerError } from "../validation/runner";
import { registerSessionRoutes, requireSession, type UiSessionConfig } from "./session";

export interface CaseApplication {
  list(): Promise<readonly ChangeCase[]>;
  show(caseKey: string): Promise<ChangeCase>;
  syncWork(caseKey: string, surface: WorkSurface, at: string): Promise<ChangeCase>;
  reconcileWork(caseKey: string, surface: WorkSurface, at: string): Promise<ChangeCase>;
  updateOwnerMappings(caseKey: string, mappings: readonly [string, string][], at: string): Promise<ChangeCase>;
  recordReceipt(caseKey: string, receipt: ValidationReceipt, at: string): Promise<ChangeCase>;
  decide(caseKey: string, surface: StatusSurface, targetUrl: string, currentHeadSha: string, at: string): Promise<ChangeCase>;
}

export interface ServerDependencies {
  readonly application: CaseApplication | CasesService;
  readonly github: () => WorkSurface & StatusSurface;
  readonly repoRoot?: string;
  readonly agent?: AgentRunApplication;
  readonly agentScope?: Readonly<{ repository: string; baseRef: string; headRef: string }>;
  readonly session?: UiSessionConfig;
  readonly uiRoot?: string;
}

export interface AgentRunApplication {
  health(): Promise<Readonly<{ available: true; provider: "qvac"; modelId: string; managed: boolean }>>;
  start(input: Readonly<{
    caseKey: string; headSha: string; prompt: string; requiredToolSequence: readonly AgentToolName[];
  }>): Promise<AgentRunSnapshot>;
  show(runId: string): Promise<AgentRunSnapshot>;
  resolveApproval(input: Readonly<{
    runId: string; token: string; currentHeadSha: string; approved: boolean; reason?: string;
  }>): Promise<AgentRunSnapshot>;
}

const caseParams = z.object({ caseKey: z.string().regex(/^[a-f0-9]{24}$/) }).strict();
const mappingsBody = z.object({
  mappings: z.array(z.tuple([z.string().startsWith("urn:li:"), z.string().regex(/^[A-Za-z0-9-]+$/)])),
}).strict();
const decisionBody = z.object({ targetUrl: z.string().url() }).strict();
const validationBody = z.object({
  workKey: z.string().regex(/^[a-f0-9]{24}$/),
  command: z.array(z.string().min(1)).min(1),
  artifactPaths: z.array(z.string().min(1)),
  timeoutMs: z.number().int().min(1).max(300_000).default(120_000),
}).strict();
const startRunBody = z.object({
  caseKey: z.string().regex(/^[a-f0-9]{24}$/),
  prompt: z.string().trim().min(1).max(2_000),
}).strict();
const runParams = z.object({ runId: z.string().min(1).max(200) }).strict();
const approvalParams = runParams.extend({ token: z.string().min(1).max(300) }).strict();
const approvalBody = z.object({ approved: z.boolean(), reason: z.string().trim().min(1).max(500).optional() }).strict();

async function verifyAgentCaseScope(dependencies: ServerDependencies, value: ChangeCase): Promise<string> {
  if (dependencies.repoRoot === undefined || dependencies.agentScope === undefined) {
    throw new Error("QVAC agent repository scope is not configured");
  }
  return await verifyGovernedAgentCaseScope({ repoRoot: dependencies.repoRoot, ...dependencies.agentScope }, value);
}

export function createServer(dependencies: ServerDependencies): FastifyInstance {
  const server = Fastify({ logger: false, bodyLimit: 1_000_000 });
  server.setErrorHandler((error, _request, reply) => {
    const status = error instanceof z.ZodError ? 400 : 502;
    const name = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message : "unknown server error";
    void reply.status(status).send({ error: name, message });
  });
  if (dependencies.uiRoot !== undefined) registerUiStaticRoutes(server, dependencies.uiRoot);
  registerSessionRoutes(server, dependencies.session);
  server.addHook("preHandler", async (request, reply) => {
    const route = request.routeOptions.url;
    if (dependencies.session === undefined || route === undefined || !/^\/api\/(cases|agent)(?:\/|$)/.test(route)) return;
    await requireSession(request, reply, dependencies.session);
  });
  server.get("/api/health", async () => ({ ok: true, service: "changemarshal" }));
  server.get("/api/agent/health", async (_request, reply) => {
    if (dependencies.agent === undefined) return await reply.status(503).send({ available: false, message: "QVAC agent runtime is not configured" });
    return await dependencies.agent.health();
  });
  server.post("/api/agent/runs", async (request, reply) => {
    if (dependencies.agent === undefined) return await reply.status(503).send({ message: "QVAC agent runtime is not configured" });
    const body = startRunBody.parse(request.body);
    const value = await dependencies.application.show(body.caseKey);
    const currentHeadSha = await verifyAgentCaseScope(dependencies, value);
    return await reply.status(202).send(await dependencies.agent.start({
      caseKey: value.caseKey, headSha: currentHeadSha, prompt: body.prompt,
      requiredToolSequence: REMEDIATION_AGENT_TOOL_SEQUENCE,
    }));
  });
  server.get("/api/agent/runs/:runId", async (request, reply) => {
    if (dependencies.agent === undefined) return await reply.status(503).send({ message: "QVAC agent runtime is not configured" });
    const { runId } = runParams.parse(request.params);
    return await dependencies.agent.show(runId);
  });
  server.get("/api/agent/runs/:runId/events", async (request, reply) => {
    if (dependencies.agent === undefined) return await reply.status(503).send({ message: "QVAC agent runtime is not configured" });
    const { runId } = runParams.parse(request.params);
    const value = await dependencies.agent.show(runId);
    const payload = value.events.map((event) => `id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`).join("");
    return await reply.header("Cache-Control", "no-cache").type("text/event-stream").send(payload);
  });
  server.post("/api/agent/runs/:runId/approvals/:token", async (request, reply) => {
    if (dependencies.agent === undefined) return await reply.status(503).send({ message: "QVAC agent runtime is not configured" });
    const { runId, token } = approvalParams.parse(request.params);
    const body = approvalBody.parse(request.body);
    const value = await dependencies.application.show((await dependencies.agent.show(runId)).caseKey);
    const currentHeadSha = await verifyAgentCaseScope(dependencies, value);
    return await dependencies.agent.resolveApproval({
      runId, token, currentHeadSha, approved: body.approved,
      ...(body.reason === undefined ? {} : { reason: body.reason }),
    });
  });
  server.get("/api/cases", async () => await dependencies.application.list());
  server.get("/api/cases/:caseKey", async (request) => {
    const { caseKey } = caseParams.parse(request.params);
    return await dependencies.application.show(caseKey);
  });
  server.post("/api/cases/:caseKey/sync", async (request) => {
    const { caseKey } = caseParams.parse(request.params);
    return await dependencies.application.syncWork(caseKey, dependencies.github(), new Date().toISOString());
  });
  server.post("/api/cases/:caseKey/reconcile", async (request) => {
    const { caseKey } = caseParams.parse(request.params);
    return await dependencies.application.reconcileWork(caseKey, dependencies.github(), new Date().toISOString());
  });
  server.post("/api/cases/:caseKey/owners", async (request) => {
    const { caseKey } = caseParams.parse(request.params);
    const body = mappingsBody.parse(request.body);
    return await dependencies.application.updateOwnerMappings(caseKey, body.mappings, new Date().toISOString());
  });
  server.post("/api/cases/:caseKey/generate", async (request) => {
    const { caseKey } = caseParams.parse(request.params);
    if (dependencies.repoRoot === undefined) throw new Error("server repository root is not configured");
    const value = await dependencies.application.show(caseKey);
    const artifacts = generateCompatibilityMigration(value);
    const validation = validateRemediation(value, artifacts);
    if (!validation.valid) throw new ValidationRunnerError(validation.errors.join("; "));
    const written = await writeRemediationArtifacts(dependencies.repoRoot, artifacts);
    return { valid: true, written, artifacts: artifacts.map(({ relativePath }) => relativePath) };
  });
  server.post("/api/cases/:caseKey/validate", async (request) => {
    const { caseKey } = caseParams.parse(request.params);
    const body = validationBody.parse(request.body);
    if (dependencies.repoRoot === undefined) throw new Error("server repository root is not configured");
    const value = await dependencies.application.show(caseKey);
    const expected = generateCompatibilityMigration(value);
    const actual = await Promise.all(expected.map(async (artifact) => ({
      relativePath: artifact.relativePath,
      content: await readFile(resolve(dependencies.repoRoot as string, artifact.relativePath), "utf8"),
    })));
    const structural = validateRemediation(value, actual);
    if (!structural.valid) throw new ValidationRunnerError(structural.errors.join("; "));
    const receipt = await runValidation({
      repoRoot: dependencies.repoRoot,
      workKey: body.workKey,
      revisionKey: value.revision.revisionKey,
      headSha: value.revision.headSha,
      command: body.command,
      artifactPaths: body.artifactPaths,
      timeoutMs: body.timeoutMs,
    });
    return await dependencies.application.recordReceipt(caseKey, receipt, new Date().toISOString());
  });
  server.post("/api/cases/:caseKey/decide", async (request) => {
    const { caseKey } = caseParams.parse(request.params);
    const body = decisionBody.parse(request.body);
    if (dependencies.repoRoot === undefined) throw new Error("server repository root is not configured");
    const head = await resolveRevision(dependencies.repoRoot, "HEAD");
    return await dependencies.application.decide(
      caseKey,
      dependencies.github(),
      body.targetUrl,
      head,
      new Date().toISOString(),
    );
  });
  return server;
}
