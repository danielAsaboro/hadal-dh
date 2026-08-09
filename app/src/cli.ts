#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runAgentTUI, type AgentTUIAgent } from "@ai-sdk/tui";
import { Command } from "commander";

import { CoordinationBriefError, coordinationModel, generateCoordinationBrief } from "./ai/coordination-brief";
import { createAgentOperations } from "./ai/operations";
import { createChangeMarshalAgent } from "./ai/orchestrator";
import { CasesService, CasesServiceError, type EvidenceSource } from "./application/cases";
import { AtomicCaseReplica } from "./application/replica";
import { aiConfigFromEnv, ConfigError, dataHubMcpConfigFromEnv, githubConfigFromEnv, parseCommand, warnLegacyProductEnv } from "./config";
import { DataHubCaseStore, DataHubCaseStoreError } from "./datahub/case-store";
import { collectEvidence, DataHubEvidenceError } from "./datahub/evidence";
import { DataHubMcpClient, DataHubMcpError } from "./datahub/mcp-client";
import { serializeCase } from "./domain/serialization";
import { resolveRevision } from "./git/repository";
import { GitHubApi } from "./github/api";
import { GitHubConnector, GitHubConnectorError } from "./github/connector";
import { generateCompatibilityMigration, RemediationGenerationError } from "./remediation/generate";
import { validateRemediation } from "./remediation/validate";
import { writeRemediationArtifacts, RemediationWriteError } from "./remediation/write";
import { runValidation, ValidationRunnerError } from "./validation/runner";

type Runtime = Readonly<{
  client: DataHubMcpClient;
  service: CasesService;
  evidence: EvidenceSource;
}>;

async function runtime(output?: string): Promise<Runtime> {
  const client = await DataHubMcpClient.connect(dataHubMcpConfigFromEnv());
  const store = new DataHubCaseStore(client);
  const evidence: EvidenceSource = {
    collect: async (change, maxHops) => await collectEvidence(client, change, maxHops),
  };
  const service = new CasesService(
    evidence,
    store,
    output === undefined ? undefined : new AtomicCaseReplica(resolve(output)),
  );
  return { client, service, evidence };
}

async function withRuntime<T>(output: string | undefined, action: (value: Runtime) => Promise<T>): Promise<T> {
  const value = await runtime(output);
  try {
    return await action(value);
  } finally {
    await value.client.close();
  }
}

function printCase(value: Awaited<ReturnType<CasesService["show"]>>): void {
  process.stdout.write(serializeCase(value));
}

function githubConnector(): GitHubConnector {
  const config = githubConfigFromEnv();
  return new GitHubConnector(new GitHubApi({ token: config.token }), config.repository, config.pullNumber);
}

function parseMapping(value: string): readonly [string, string] {
  const separator = value.indexOf("=");
  const owner = value.slice(0, separator);
  const login = value.slice(separator + 1);
  if (separator < 1 || !owner.startsWith("urn:li:") || !/^[A-Za-z0-9-]+$/.test(login)) {
    throw new ConfigError("owner mapping must be DATAHUB_URN=GITHUB_LOGIN");
  }
  return [owner, login];
}

export function buildCli(): Command {
  const program = new Command()
    .name("changemarshal")
    .description("Govern data changes from DataHub graph evidence through accountable work")
    .version("0.2.0");
  const cases = program.command("case").description("Plan and coordinate governed change cases");

  cases.command("plan")
    .requiredOption("--repo <path>", "real Git repository worktree")
    .requiredOption("--repository <owner/name>", "GitHub repository identity")
    .requiredOption("--base <ref>", "base Git revision")
    .requiredOption("--head <ref>", "head Git revision")
    .option("--max-hops <number>", "maximum downstream lineage hops", "3")
    .option("--output <path>", "verified local audit replica", ".changemarshal/case.json")
    .action(async (options: Record<string, string>) => {
      const maxHops = Number(options.maxHops);
      const value = await withRuntime(options.output, async ({ service }) => await service.plan({
        repoRoot: resolve(options.repo as string),
        repository: options.repository as string,
        baseRef: options.base as string,
        headRef: options.head as string,
        maxHops,
        observedAt: new Date().toISOString(),
      }));
      printCase(value);
    });

  cases.command("show")
    .requiredOption("--case-key <key>")
    .action(async (options: Record<string, string>) => {
      printCase(await withRuntime(undefined, async ({ service }) => await service.show(options.caseKey as string)));
    });

  cases.command("map-owner")
    .requiredOption("--case-key <key>")
    .requiredOption("--map <urn=login...>", "repeatable governed owner mapping")
    .option("--output <path>", "verified local audit replica", ".changemarshal/case.json")
    .action(async (options: { caseKey: string; map: string[]; output: string }) => {
      const value = await withRuntime(options.output, async ({ service }) => {
        const current = await service.show(options.caseKey);
        const merged = new Map(current.ownerMappings);
        for (const raw of options.map) {
          const [owner, login] = parseMapping(raw);
          merged.set(owner, login);
        }
        return await service.updateOwnerMappings(options.caseKey, [...merged], new Date().toISOString());
      });
      printCase(value);
    });

  cases.command("sync-github")
    .requiredOption("--case-key <key>")
    .option("--output <path>", "verified local audit replica", ".changemarshal/case.json")
    .action(async (options: { caseKey: string; output: string }) => {
      printCase(await withRuntime(options.output, async ({ service }) =>
        await service.syncWork(options.caseKey, githubConnector(), new Date().toISOString())));
    });

  cases.command("reconcile")
    .requiredOption("--case-key <key>")
    .option("--output <path>", "verified local audit replica", ".changemarshal/case.json")
    .action(async (options: { caseKey: string; output: string }) => {
      printCase(await withRuntime(options.output, async ({ service }) =>
        await service.reconcileWork(options.caseKey, githubConnector(), new Date().toISOString())));
    });

  cases.command("generate")
    .requiredOption("--case-key <key>")
    .requiredOption("--repo <path>")
    .action(async (options: { caseKey: string; repo: string }) => {
      const current = await withRuntime(undefined, async ({ service }) => await service.show(options.caseKey));
      const artifacts = generateCompatibilityMigration(current);
      const validation = validateRemediation(current, artifacts);
      if (!validation.valid) throw new RemediationGenerationError(validation.errors.join("; "));
      const written = await writeRemediationArtifacts(resolve(options.repo), artifacts);
      process.stdout.write(`${JSON.stringify({ valid: true, written, artifacts: artifacts.map(({ relativePath }) => relativePath) }, null, 2)}\n`);
    });

  cases.command("brief")
    .description("Generate a non-authoritative AI SDK 7 coordination brief from the verified case")
    .requiredOption("--case-key <key>")
    .action(async (options: { caseKey: string }) => {
      const current = await withRuntime(undefined, async ({ service }) => await service.show(options.caseKey));
      const brief = await generateCoordinationBrief(current, coordinationModel(aiConfigFromEnv()));
      process.stdout.write(`${JSON.stringify(brief, null, 2)}\n`);
    });

  cases.command("validate")
    .requiredOption("--case-key <key>")
    .requiredOption("--work-key <key>")
    .requiredOption("--repo <path>")
    .requiredOption("--command-json <json>", "argument array; never a shell string")
    .requiredOption("--artifact <paths...>", "repository-relative artifacts to hash")
    .option("--timeout-ms <number>", "command timeout", "120000")
    .option("--output <path>", "verified local audit replica", ".changemarshal/case.json")
    .action(async (options: { caseKey: string; workKey: string; repo: string; commandJson: string; artifact: string[]; timeoutMs: string; output: string }) => {
      const current = await withRuntime(undefined, async ({ service }) => await service.show(options.caseKey));
      const expected = generateCompatibilityMigration(current);
      const actual = await Promise.all(expected.map(async (artifact) => ({
        relativePath: artifact.relativePath,
        content: await readFile(resolve(options.repo, artifact.relativePath), "utf8"),
      })));
      const structural = validateRemediation(current, actual);
      if (!structural.valid) throw new ValidationRunnerError(structural.errors.join("; "));
      const receipt = await runValidation({
        repoRoot: resolve(options.repo),
        workKey: options.workKey,
        revisionKey: current.revision.revisionKey,
        headSha: current.revision.headSha,
        command: parseCommand(options.commandJson),
        artifactPaths: options.artifact,
        timeoutMs: Number(options.timeoutMs),
      });
      printCase(await withRuntime(options.output, async ({ service }) =>
        await service.recordReceipt(options.caseKey, receipt, new Date().toISOString())));
    });

  cases.command("decide")
    .requiredOption("--case-key <key>")
    .requiredOption("--repo <path>")
    .requiredOption("--target-url <url>")
    .option("--output <path>", "verified local audit replica", ".changemarshal/case.json")
    .action(async (options: { caseKey: string; repo: string; targetUrl: string; output: string }) => {
      const head = await resolveRevision(resolve(options.repo), "HEAD");
      printCase(await withRuntime(options.output, async ({ service }) =>
        await service.decide(options.caseKey, githubConnector(), options.targetUrl, head, new Date().toISOString())));
    });

  program.command("agent")
    .description("Run the approval-gated AI SDK 7 ToolLoopAgent in an interactive terminal")
    .requiredOption("--repo <path>", "fixed real Git repository worktree")
    .requiredOption("--repository <owner/name>", "stable repository identity")
    .requiredOption("--base <ref>", "fixed base Git revision")
    .requiredOption("--head <ref>", "fixed head Git revision")
    .requiredOption("--target-url <url>", "canonical case workspace URL for GitHub status")
    .requiredOption("--map <urn=login...>", "operator-approved owner mappings")
    .requiredOption("--validation-command-json <json>", "fixed validator argument array; never a shell string")
    .requiredOption("--artifact <paths...>", "fixed repository-relative artifacts to hash")
    .option("--max-hops <number>", "maximum downstream lineage hops", "3")
    .option("--output <path>", "verified local audit replica", ".changemarshal/case.json")
    .action(async (options: {
      repo: string; repository: string; base: string; head: string; targetUrl: string;
      map: string[]; validationCommandJson: string; artifact: string[]; maxHops: string; output: string;
    }) => {
      const value = await runtime(options.output);
      try {
        const connector = githubConnector();
        const scope = {
          repoRoot: resolve(options.repo),
          repository: options.repository,
          baseRef: options.base,
          headRef: options.head,
          targetUrl: options.targetUrl,
          maxHops: Number(options.maxHops),
          ownerMappings: options.map.map(parseMapping),
          validationCommand: parseCommand(options.validationCommandJson),
          artifactPaths: options.artifact,
        };
        const agent = createChangeMarshalAgent({
          model: coordinationModel(aiConfigFromEnv()),
          scope,
          operations: createAgentOperations({
            scope,
            evidence: value.evidence,
            service: value.service,
            workSurface: connector,
            statusSurface: connector,
          }),
        });
        // @ai-sdk/tui declares Agent<any,...>, which is contravariantly wider
        // than a no-call-options ToolLoopAgent under exactOptionalPropertyTypes.
        await runAgentTUI({ title: "ChangeMarshal", agent: agent as AgentTUIAgent, tools: "full", reasoning: "collapsed" });
      } finally {
        await value.client.close();
      }
    });

  return program;
}

export function exitCodeFor(error: unknown): number {
  if (error instanceof ConfigError) return 2;
  if (error instanceof DataHubEvidenceError || error instanceof DataHubMcpError || error instanceof DataHubCaseStoreError) return 3;
  if (error instanceof GitHubConnectorError) return 4;
  if (error instanceof ValidationRunnerError || error instanceof RemediationGenerationError || error instanceof RemediationWriteError) return 5;
  if (error instanceof CoordinationBriefError) return 7;
  if (error instanceof CasesServiceError) return 6;
  return 1;
}

export async function main(argv = process.argv): Promise<void> {
  try {
    warnLegacyProductEnv();
    await buildCli().parseAsync(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown ChangeMarshal failure";
    process.stderr.write(`ChangeMarshal failed: ${message}\n`);
    process.exitCode = exitCodeFor(error);
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
