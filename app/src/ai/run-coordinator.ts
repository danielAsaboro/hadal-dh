import { createHash, randomUUID } from "node:crypto";

import { MUTATING_AGENT_TOOLS } from "./orchestrator";
import { AgentRunSnapshotSchema, type AgentRunEvent, type AgentRunSnapshot } from "./run-events";

type IdPrefix = "run" | "approval";

type CoordinatorDependencies = Readonly<{
  now?: () => Date;
  id?: (prefix: IdPrefix) => string;
  approvalTtlMs?: number;
}>;

type MutableRun = {
  runId: string;
  caseKey: string;
  headSha: string;
  modelId: string;
  status: AgentRunSnapshot["status"];
  events: AgentRunEvent[];
  answer?: string;
  pendingApproval?: AgentRunSnapshot["pendingApproval"];
};

export class AgentRunError extends Error {
  override readonly name = "AgentRunError";
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function argumentsHash(input: unknown): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export class AgentRunCoordinator {
  readonly #runs = new Map<string, MutableRun>();
  readonly #usedTokens = new Set<string>();
  readonly #now: () => Date;
  readonly #id: (prefix: IdPrefix) => string;
  readonly #approvalTtlMs: number;

  constructor(dependencies: CoordinatorDependencies = {}) {
    this.#now = dependencies.now ?? (() => new Date());
    this.#id = dependencies.id ?? ((prefix) => `${prefix}-${randomUUID()}`);
    this.#approvalTtlMs = dependencies.approvalTtlMs ?? 15 * 60_000;
  }

  start(input: Readonly<{ caseKey: string; headSha: string; modelId: string; prompt: string }>): AgentRunSnapshot {
    if (input.prompt.trim().length === 0) throw new AgentRunError("agent prompt must not be empty");
    const run: MutableRun = {
      runId: this.#id("run"), caseKey: input.caseKey, headSha: input.headSha, modelId: input.modelId,
      status: "running", events: [],
    };
    this.#append(run, { kind: "run_started", summary: `Governed run started for ${input.caseKey}` });
    this.#append(run, { kind: "model_connected", summary: `Connected to QVAC model ${input.modelId}` });
    this.#runs.set(run.runId, run);
    return this.#snapshot(run);
  }

  show(runId: string): AgentRunSnapshot {
    return this.#snapshot(this.#run(runId));
  }

  toolProposed(runId: string, call: Readonly<{ toolName: string; toolCallId: string }>): AgentRunSnapshot {
    const run = this.#activeRun(runId);
    this.#append(run, { kind: "tool_proposed", summary: `Model proposed ${call.toolName}`, ...call });
    return this.#snapshot(run);
  }

  toolStarted(runId: string, call: Readonly<{ toolName: string; toolCallId: string }>): AgentRunSnapshot {
    const run = this.#activeRun(runId);
    this.#append(run, { kind: "tool_started", summary: `Started ${call.toolName}`, ...call });
    return this.#snapshot(run);
  }

  toolCompleted(runId: string, call: Readonly<{ toolName: string; toolCallId: string }>): AgentRunSnapshot {
    const run = this.#activeRun(runId);
    this.#append(run, { kind: "tool_completed", summary: `Completed ${call.toolName}`, ...call });
    return this.#snapshot(run);
  }

  toolFailed(runId: string, call: Readonly<{ toolName: string; toolCallId: string; summary: string }>): AgentRunSnapshot {
    const run = this.#activeRun(runId);
    this.#append(run, { kind: "tool_failed", ...call });
    return this.#snapshot(run);
  }

  complete(runId: string, answer: string): AgentRunSnapshot {
    const run = this.#activeRun(runId);
    const groundedAnswer = answer.trim();
    if (groundedAnswer.length === 0) throw new AgentRunError("agent completed without an answer");
    run.answer = groundedAnswer.slice(0, 20_000);
    this.#append(run, { kind: "answer_emitted", summary: "Grounded agent answer emitted" });
    run.status = "completed";
    this.#append(run, { kind: "run_completed", summary: "Governed run completed" });
    return this.#snapshot(run);
  }

  fail(runId: string, summary: string): AgentRunSnapshot {
    const run = this.#activeRun(runId);
    delete run.pendingApproval;
    run.status = "failed";
    this.#append(run, { kind: "run_failed", summary });
    return this.#snapshot(run);
  }

  requireApproval(runId: string, call: Readonly<{
    approvalId: string; toolCallId: string; toolName: string; input: unknown;
  }>): AgentRunSnapshot {
    const run = this.#run(runId);
    if (!MUTATING_AGENT_TOOLS.includes(call.toolName as (typeof MUTATING_AGENT_TOOLS)[number])) {
      throw new AgentRunError(`tool ${call.toolName} is not an approval-gated mutation`);
    }
    if (run.pendingApproval !== undefined) throw new AgentRunError("run already has a pending approval");
    const now = this.#now();
    const hash = argumentsHash(call.input);
    run.pendingApproval = {
      token: this.#id("approval"), approvalId: call.approvalId, toolCallId: call.toolCallId,
      toolName: call.toolName, argumentsHash: hash, requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.#approvalTtlMs).toISOString(),
    };
    run.status = "waiting_for_approval";
    this.#append(run, {
      kind: "approval_required", summary: `Approval required for ${call.toolName}`, toolName: call.toolName,
      toolCallId: call.toolCallId, approvalId: call.approvalId, argumentsHash: hash,
    });
    return this.#snapshot(run);
  }

  resolveApproval(runId: string, token: string, currentHeadSha: string, approved: boolean, reason?: string): AgentRunSnapshot {
    if (this.#usedTokens.has(token)) throw new AgentRunError("approval token was already used");
    const run = this.#run(runId);
    const pending = run.pendingApproval;
    if (pending === undefined || pending.token !== token) throw new AgentRunError("unknown approval token");
    if (run.headSha !== currentHeadSha) throw new AgentRunError("Git head changed after approval was requested");
    if (Date.parse(pending.expiresAt) < this.#now().getTime()) throw new AgentRunError("approval token expired");
    this.#usedTokens.add(token);
    delete run.pendingApproval;
    run.status = "running";
    this.#append(run, {
      kind: approved ? "tool_approved" : "tool_denied",
      summary: reason?.trim() || `${pending.toolName} ${approved ? "approved" : "denied"}`,
      toolName: pending.toolName, toolCallId: pending.toolCallId, approvalId: pending.approvalId,
      argumentsHash: pending.argumentsHash, approved,
    });
    return this.#snapshot(run);
  }

  #run(runId: string): MutableRun {
    const value = this.#runs.get(runId);
    if (value === undefined) throw new AgentRunError(`unknown agent run ${runId}`);
    return value;
  }

  #activeRun(runId: string): MutableRun {
    const run = this.#run(runId);
    if (run.status === "completed" || run.status === "failed") {
      throw new AgentRunError(`agent run ${runId} is terminal`);
    }
    return run;
  }

  #append(run: MutableRun, event: Omit<AgentRunEvent, "sequence" | "at">): void {
    run.events.push({ ...event, sequence: run.events.length + 1, at: this.#now().toISOString() });
  }

  #snapshot(run: MutableRun): AgentRunSnapshot {
    return AgentRunSnapshotSchema.parse({
      runId: run.runId, caseKey: run.caseKey, headSha: run.headSha, modelId: run.modelId,
      status: run.status, events: structuredClone(run.events),
      ...(run.answer === undefined ? {} : { answer: run.answer }),
      ...(run.pendingApproval === undefined ? {} : { pendingApproval: structuredClone(run.pendingApproval) }),
    });
  }
}
