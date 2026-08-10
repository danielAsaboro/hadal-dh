import type { ModelMessage } from "ai";

import { AgentRunCoordinator } from "./run-coordinator";
import type { AgentRunSnapshot } from "./run-events";
import { createChangeMarshalAgent } from "./orchestrator";

type ToolCall = Readonly<{ toolCallId: string; toolName: string; input: unknown }>;
type ToolExecutionStart = Readonly<{ toolCall: ToolCall }>;
type ToolExecutionEnd = Readonly<{
  toolCall: ToolCall;
  toolOutput: Readonly<{ type: string; error?: unknown }>;
}>;

export interface AgentGenerationResult {
  readonly text: string;
  readonly content: readonly unknown[];
  readonly response: Readonly<{ messages: readonly ModelMessage[] }>;
}

export interface AgentGenerator {
  generate(options: Readonly<{
    messages: readonly ModelMessage[];
    onToolExecutionStart: (event: ToolExecutionStart) => void;
    onToolExecutionEnd: (event: ToolExecutionEnd) => void;
  }>): Promise<AgentGenerationResult>;
}

export function adaptChangeMarshalAgent(
  agent: ReturnType<typeof createChangeMarshalAgent>,
): AgentGenerator {
  return {
    generate: async (options) => {
      const result = await agent.generate({
        messages: [...options.messages],
        onToolExecutionStart: (event) => options.onToolExecutionStart({
          toolCall: {
            toolCallId: event.toolCall.toolCallId,
            toolName: event.toolCall.toolName,
            input: event.toolCall.input,
          },
        }),
        onToolExecutionEnd: (event) => options.onToolExecutionEnd({
          toolCall: {
            toolCallId: event.toolCall.toolCallId,
            toolName: event.toolCall.toolName,
            input: event.toolCall.input,
          },
          toolOutput: event.toolOutput,
        }),
      });
      return { text: result.text, content: result.content, response: { messages: result.response.messages } };
    },
  };
}

type Dependencies = Readonly<{
  coordinator: AgentRunCoordinator;
  generator: AgentGenerator;
  modelId: string;
  managed: boolean;
}>;

type Transcript = {
  messages: ModelMessage[];
};

type ApprovalRequest = Readonly<{
  type: "tool-approval-request";
  approvalId: string;
  toolCall: ToolCall;
}>;

function approvalRequest(value: unknown): value is ApprovalRequest {
  if (value === null || typeof value !== "object") return false;
  const part = value as Record<string, unknown>;
  if (part.type !== "tool-approval-request" || typeof part.approvalId !== "string") return false;
  if (part.toolCall === null || typeof part.toolCall !== "object") return false;
  const call = part.toolCall as Record<string, unknown>;
  return typeof call.toolCallId === "string" && typeof call.toolName === "string" && "input" in call;
}

function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown agent runtime failure";
  return message.slice(0, 500);
}

export class GovernedAgentRunService {
  readonly #coordinator: AgentRunCoordinator;
  readonly #generator: AgentGenerator;
  readonly #modelId: string;
  readonly #managed: boolean;
  readonly #transcripts = new Map<string, Transcript>();

  constructor(dependencies: Dependencies) {
    this.#coordinator = dependencies.coordinator;
    this.#generator = dependencies.generator;
    this.#modelId = dependencies.modelId;
    this.#managed = dependencies.managed;
  }

  async health() {
    return { available: true as const, provider: "qvac" as const, modelId: this.#modelId, managed: this.#managed };
  }

  async start(input: Readonly<{ caseKey: string; headSha: string; prompt: string }>): Promise<AgentRunSnapshot> {
    const started = this.#coordinator.start({ ...input, modelId: this.#modelId });
    this.#transcripts.set(started.runId, { messages: [{
      role: "user",
      content: `Governed case key: ${input.caseKey}\nExpected Git head SHA: ${input.headSha}\n\nOperator request:\n${input.prompt}`,
    }] });
    return await this.#generate(started.runId);
  }

  async show(runId: string): Promise<AgentRunSnapshot> {
    return this.#coordinator.show(runId);
  }

  async resolveApproval(input: Readonly<{
    runId: string; token: string; currentHeadSha: string; approved: boolean; reason?: string;
  }>): Promise<AgentRunSnapshot> {
    const before = this.#coordinator.show(input.runId);
    const pending = before.pendingApproval;
    if (pending === undefined) throw new Error("agent run has no pending approval");
    this.#coordinator.resolveApproval(input.runId, input.token, input.currentHeadSha, input.approved, input.reason);
    const transcript = this.#transcript(input.runId);
    transcript.messages.push({
      role: "tool",
      content: [{
        type: "tool-approval-response",
        approvalId: pending.approvalId,
        approved: input.approved,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      }],
    });
    return await this.#generate(input.runId);
  }

  async #generate(runId: string): Promise<AgentRunSnapshot> {
    const transcript = this.#transcript(runId);
    try {
      const result = await this.#generator.generate({
        messages: [...transcript.messages],
        onToolExecutionStart: ({ toolCall }) => {
          this.#coordinator.toolStarted(runId, { toolName: toolCall.toolName, toolCallId: toolCall.toolCallId });
        },
        onToolExecutionEnd: ({ toolCall, toolOutput }) => {
          if (toolOutput.type === "tool-error") {
            this.#coordinator.toolFailed(runId, {
              toolName: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
              summary: `${toolCall.toolName} failed: ${errorSummary(toolOutput.error)}`,
            });
          } else {
            this.#coordinator.toolCompleted(runId, { toolName: toolCall.toolName, toolCallId: toolCall.toolCallId });
          }
        },
      });
      transcript.messages.push(...result.response.messages);
      const approvals = result.content.filter(approvalRequest);
      if (approvals.length > 1) {
        return this.#coordinator.fail(runId, "Agent must request exactly one mutation approval at a time");
      }
      const approval = approvals[0];
      if (approval !== undefined) {
        this.#coordinator.toolProposed(runId, {
          toolName: approval.toolCall.toolName,
          toolCallId: approval.toolCall.toolCallId,
        });
        return this.#coordinator.requireApproval(runId, {
          approvalId: approval.approvalId,
          toolCallId: approval.toolCall.toolCallId,
          toolName: approval.toolCall.toolName,
          input: approval.toolCall.input,
        });
      }
      this.#transcripts.delete(runId);
      return this.#coordinator.complete(runId, result.text);
    } catch (error) {
      this.#transcripts.delete(runId);
      return this.#coordinator.fail(runId, errorSummary(error));
    }
  }

  #transcript(runId: string): Transcript {
    const transcript = this.#transcripts.get(runId);
    if (transcript === undefined) throw new Error(`agent transcript ${runId} is unavailable`);
    return transcript;
  }
}
