import { ToolLoopAgent, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";

export const MUTATING_AGENT_TOOLS = [
  "planChangeCase",
  "mapOwners",
  "syncGitHubWork",
  "generateRemediation",
  "validateWork",
  "reconcileGitHubWork",
  "publishMergeDecision",
] as const;

export const AGENT_TOOL_APPROVAL = Object.fromEntries(
  MUTATING_AGENT_TOOLS.map((name) => [name, "user-approval"]),
) as Readonly<Record<(typeof MUTATING_AGENT_TOOLS)[number], "user-approval">>;

export interface AgentScope {
  readonly repoRoot: string;
  readonly repository: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly targetUrl: string;
  readonly maxHops: number;
  readonly ownerMappings: readonly (readonly [string, string])[];
  readonly validationCommand: readonly string[];
  readonly artifactPaths: readonly string[];
}

export interface AgentOperations {
  inspectGitChange(): Promise<unknown>;
  inspectDataHubImpact(): Promise<unknown>;
  planChangeCase(): Promise<unknown>;
  readCase(caseKey: string): Promise<unknown>;
  mapOwners(caseKey: string): Promise<unknown>;
  syncGitHubWork(caseKey: string): Promise<unknown>;
  generateRemediation(caseKey: string): Promise<unknown>;
  validateWork(caseKey: string, workKey: string): Promise<unknown>;
  reconcileGitHubWork(caseKey: string): Promise<unknown>;
  publishMergeDecision(caseKey: string): Promise<unknown>;
}

type AgentDependencies = Readonly<{
  model: LanguageModel;
  scope: AgentScope;
  operations: AgentOperations;
}>;

const noInput = z.object({}).strict();
const caseInput = z.object({ caseKey: z.string().regex(/^[a-f0-9]{24}$/) }).strict();

export function createChangeMarshalAgent(dependencies: AgentDependencies) {
  const tools = {
    inspectGitChange: tool({
      description: "Read the fixed real Git base/head and detect the supported dbt column rename. This does not write state.",
      inputSchema: noInput,
      execute: async () => await dependencies.operations.inspectGitChange(),
    }),
    inspectDataHubImpact: tool({
      description: "Read schema, lineage, ownership, governance, queries, incidents, and available assertions from DataHub for the fixed Git change. This does not write state.",
      inputSchema: noInput,
      execute: async () => await dependencies.operations.inspectDataHubImpact(),
    }),
    planChangeCase: tool({
      description: "Compile the fixed Git and DataHub evidence into the canonical case and persist then reread it in DataHub.",
      inputSchema: noInput,
      execute: async () => await dependencies.operations.planChangeCase(),
    }),
    readCase: tool({
      description: "Reread one canonical case from DataHub without mutating it.",
      inputSchema: caseInput,
      execute: async ({ caseKey }) => await dependencies.operations.readCase(caseKey),
    }),
    mapOwners: tool({
      description: "Apply only the operator-configured DataHub-owner to GitHub-login mappings and persist the case.",
      inputSchema: caseInput,
      execute: async ({ caseKey }) => await dependencies.operations.mapOwners(caseKey),
    }),
    syncGitHubWork: tool({
      description: "Create or update marker-bound GitHub issues, request real PR reviewers, reread all mutations, and persist projections to DataHub.",
      inputSchema: caseInput,
      execute: async ({ caseKey }) => await dependencies.operations.syncGitHubWork(caseKey),
    }),
    generateRemediation: tool({
      description: "Write the deterministic, graph-grounded compatibility SQL and dbt schema artifacts into the fixed repository.",
      inputSchema: caseInput,
      execute: async ({ caseKey }) => await dependencies.operations.generateRemediation(caseKey),
    }),
    validateWork: tool({
      description: "Run the fixed operator-configured validator without a shell, hash artifacts and output, and persist the receipt to DataHub.",
      inputSchema: z.object({
        caseKey: z.string().regex(/^[a-f0-9]{24}$/),
        workKey: z.string().regex(/^[a-f0-9]{24}$/),
      }).strict(),
      execute: async ({ caseKey, workKey }) => await dependencies.operations.validateWork(caseKey, workKey),
    }),
    reconcileGitHubWork: tool({
      description: "Reread GitHub issues and submitted current-head reviews, then persist verified projections and approval provenance to DataHub.",
      inputSchema: caseInput,
      execute: async ({ caseKey }) => await dependencies.operations.reconcileGitHubWork(caseKey),
    }),
    publishMergeDecision: tool({
      description: "Evaluate deterministic policy for the current Git head, persist/reread the case, and publish/reread the resulting GitHub status. The model cannot choose the verdict.",
      inputSchema: caseInput,
      execute: async ({ caseKey }) => await dependencies.operations.publishMergeDecision(caseKey),
    }),
  };

  return new ToolLoopAgent({
    id: "changemarshal-governed-change",
    model: dependencies.model,
    temperature: 0,
    stopWhen: stepCountIs(12),
    timeout: { totalMs: 3 * 60_000, stepMs: 75_000, toolMs: 2 * 60_000 },
    tools,
    toolApproval: AGENT_TOOL_APPROVAL,
    instructions: [
      "You are ChangeMarshal's governed change coordinator.",
      "Inspect the fixed Git diff and DataHub evidence before proposing mutations.",
      "Use exact returned case keys, work keys, Git SHAs, DataHub URNs, and owner facts; never invent them.",
      "Every mutating tool requires a signed human approval. A denial is final for that call.",
      "Only publishMergeDecision may report admission, and its deterministic result is authoritative even when blocked.",
      "Do not describe a projection, approval, validation, write-back, or merge state as successful unless its tool result confirms reread verification.",
      `Fixed scope: repository ${dependencies.scope.repository}; refs ${dependencies.scope.baseRef}..${dependencies.scope.headRef}; maximum lineage hops ${dependencies.scope.maxHops}.`,
    ].join(" "),
  });
}
