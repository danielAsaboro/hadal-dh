import { ToolLoopAgent, stepCountIs, tool, type LanguageModel, type ModelMessage } from "ai";
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

export const AGENT_TOOL_NAMES = [
  "inspectGitChange", "inspectDataHubImpact", "planChangeCase", "readCase", "mapOwners",
  "syncGitHubWork", "generateRemediation", "validateWork", "reconcileGitHubWork", "publishMergeDecision",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export const REMEDIATION_AGENT_TOOL_SEQUENCE = ["readCase", "generateRemediation"] as const satisfies readonly AgentToolName[];

export const AGENT_TIMEOUT = {
  totalMs: 5 * 60_000,
  stepMs: 150_000,
  toolMs: 2 * 60_000,
} as const;

const AgentCallOptionsSchema = z.object({
  governedCaseKey: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  requiredToolSequence: z.array(z.enum(AGENT_TOOL_NAMES)).min(1).max(12).optional(),
}).strict();

export type AgentCallOptions = z.infer<typeof AgentCallOptionsSchema>;
type RequiredAgentCallOptions = Readonly<{
  governedCaseKey: string;
  requiredToolSequence: readonly AgentToolName[];
}>;
type AgentRuntimeContext = Record<string, unknown> & RequiredAgentCallOptions;

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
  defaultCallOptions?: RequiredAgentCallOptions;
}>;

const noInput = z.object({}).strict();
const caseInput = z.object({ caseKey: z.string().regex(/^[a-f0-9]{24}$/) }).strict();
const governedCaseContext = z.object({ caseKey: z.string().regex(/^[a-f0-9]{24}$/) }).strict();

function assertGovernedCase(input: string, context: Readonly<{ caseKey: string }> | undefined): void {
  if (context === undefined || input !== context.caseKey) {
    throw new Error(`tool case key ${input} does not match the governed run case`);
  }
}

function resolveCallOptions(
  options: AgentCallOptions | undefined,
  defaults: RequiredAgentCallOptions | undefined,
): RequiredAgentCallOptions {
  const validatedDefaults = defaults === undefined ? undefined : AgentCallOptionsSchema.parse(defaults);
  const governedCaseKey = options?.governedCaseKey ?? validatedDefaults?.governedCaseKey;
  const requiredToolSequence = options?.requiredToolSequence ?? validatedDefaults?.requiredToolSequence;
  if (governedCaseKey === undefined || requiredToolSequence === undefined || requiredToolSequence.length === 0) {
    throw new Error("governed case key and deterministic tool sequence are required");
  }
  return { governedCaseKey, requiredToolSequence };
}

function caseToolsContext(caseKey: string) {
  const value = { caseKey };
  return {
    readCase: value,
    mapOwners: value,
    syncGitHubWork: value,
    generateRemediation: value,
    validateWork: value,
    reconcileGitHubWork: value,
    publishMergeDecision: value,
  };
}

function hasApprovalResponse(messages: readonly ModelMessage[]): boolean {
  return messages.some((message) => Array.isArray(message.content) && message.content.some((part) =>
    typeof part === "object" && part !== null && "type" in part && part.type === "tool-approval-response"));
}

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
      contextSchema: governedCaseContext,
      execute: async ({ caseKey }, { context }) => {
        assertGovernedCase(caseKey, context);
        return await dependencies.operations.readCase(caseKey);
      },
    }),
    mapOwners: tool({
      description: "Apply only the operator-configured DataHub-owner to GitHub-login mappings and persist the case.",
      inputSchema: caseInput,
      contextSchema: governedCaseContext,
      execute: async ({ caseKey }, { context }) => {
        assertGovernedCase(caseKey, context);
        return await dependencies.operations.mapOwners(caseKey);
      },
    }),
    syncGitHubWork: tool({
      description: "Create or update marker-bound GitHub issues, request real PR reviewers, reread all mutations, and persist projections to DataHub.",
      inputSchema: caseInput,
      contextSchema: governedCaseContext,
      execute: async ({ caseKey }, { context }) => {
        assertGovernedCase(caseKey, context);
        return await dependencies.operations.syncGitHubWork(caseKey);
      },
    }),
    generateRemediation: tool({
      description: "Write the deterministic, graph-grounded compatibility SQL and dbt schema artifacts into the fixed repository.",
      inputSchema: caseInput,
      contextSchema: governedCaseContext,
      execute: async ({ caseKey }, { context }) => {
        assertGovernedCase(caseKey, context);
        return await dependencies.operations.generateRemediation(caseKey);
      },
    }),
    validateWork: tool({
      description: "Run the fixed operator-configured validator without a shell, hash artifacts and output, and persist the receipt to DataHub.",
      inputSchema: z.object({
        caseKey: z.string().regex(/^[a-f0-9]{24}$/),
        workKey: z.string().regex(/^[a-f0-9]{24}$/),
      }).strict(),
      contextSchema: governedCaseContext,
      execute: async ({ caseKey, workKey }, { context }) => {
        assertGovernedCase(caseKey, context);
        return await dependencies.operations.validateWork(caseKey, workKey);
      },
    }),
    reconcileGitHubWork: tool({
      description: "Reread GitHub issues and submitted current-head reviews, then persist verified projections and approval provenance to DataHub.",
      inputSchema: caseInput,
      contextSchema: governedCaseContext,
      execute: async ({ caseKey }, { context }) => {
        assertGovernedCase(caseKey, context);
        return await dependencies.operations.reconcileGitHubWork(caseKey);
      },
    }),
    publishMergeDecision: tool({
      description: "Evaluate deterministic policy for the current Git head, persist/reread the case, and publish/reread the resulting GitHub status. The model cannot choose the verdict.",
      inputSchema: caseInput,
      contextSchema: governedCaseContext,
      execute: async ({ caseKey }, { context }) => {
        assertGovernedCase(caseKey, context);
        return await dependencies.operations.publishMergeDecision(caseKey);
      },
    }),
  };

  return new ToolLoopAgent<AgentCallOptions, typeof tools, AgentRuntimeContext>({
    id: "changemarshal-governed-change",
    model: dependencies.model,
    temperature: 0,
    maxOutputTokens: 512,
    stopWhen: stepCountIs(12),
    timeout: AGENT_TIMEOUT,
    tools,
    toolApproval: AGENT_TOOL_APPROVAL,
    callOptionsSchema: AgentCallOptionsSchema,
    toolsContext: caseToolsContext("0".repeat(24)),
    runtimeContext: { governedCaseKey: "0".repeat(24), requiredToolSequence: [] },
    prepareCall: ({ options, ...rest }) => {
      const governed = resolveCallOptions(options, dependencies.defaultCallOptions);
      return {
        ...rest,
        toolsContext: caseToolsContext(governed.governedCaseKey),
        runtimeContext: governed,
      };
    },
    prepareStep: ({ stepNumber, messages, runtimeContext }) => {
      if (hasApprovalResponse(messages)) return { toolChoice: "auto" };
      const toolName = runtimeContext.requiredToolSequence[stepNumber];
      return toolName === undefined
        ? { toolChoice: "auto" }
        : { activeTools: [toolName], toolChoice: { type: "tool", toolName } };
    },
    instructions: [
      "You are Hadal's governed change coordinator.",
      "Inspect the fixed Git diff and DataHub evidence before proposing mutations.",
      "Use exact returned case keys, work keys, Git SHAs, DataHub URNs, and owner facts; never invent them.",
      "Every mutating tool requires a signed human approval. A denial is final for that call.",
      "Only publishMergeDecision may report admission, and its deterministic result is authoritative even when blocked.",
      "Do not describe a projection, approval, validation, write-back, or merge state as successful unless its tool result confirms reread verification.",
      `Fixed scope: repository ${dependencies.scope.repository}; refs ${dependencies.scope.baseRef}..${dependencies.scope.headRef}; maximum lineage hops ${dependencies.scope.maxHops}.`,
    ].join(" "),
  });
}
