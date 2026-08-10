import { z } from "zod";

export {
  AgentRunEventSchema,
  AgentRunStatusSchema,
  type AgentRunEvent,
} from "../domain/agent-audit";
import { AgentRunEventSchema, AgentRunStatusSchema } from "../domain/agent-audit";
import { DurableAgentRunSchema, type DurableAgentRun } from "../domain/agent-audit";

export const PendingAgentApprovalSchema = z.object({
  token: z.string().min(1),
  approvalId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  argumentsHash: z.string().regex(/^[a-f0-9]{64}$/),
  requestedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();

export const AgentRunSnapshotSchema = z.object({
  runId: z.string().min(1),
  caseKey: z.string().regex(/^[a-f0-9]{24}$/),
  headSha: z.string().regex(/^[a-f0-9]{40}$/),
  modelId: z.string().min(1),
  status: AgentRunStatusSchema,
  events: z.array(AgentRunEventSchema),
  answer: z.string().min(1).max(20_000).optional(),
  pendingApproval: PendingAgentApprovalSchema.optional(),
}).strict();

export type AgentRunSnapshot = z.infer<typeof AgentRunSnapshotSchema>;
export type PendingAgentApproval = z.infer<typeof PendingAgentApprovalSchema>;

export function toDurableAgentRun(snapshot: AgentRunSnapshot, revisionKey: string): DurableAgentRun {
  const first = snapshot.events[0];
  const last = snapshot.events.at(-1);
  if (first === undefined || last === undefined) throw new Error("agent run has no durable events");
  const pending = snapshot.pendingApproval;
  return DurableAgentRunSchema.parse({
    runId: snapshot.runId,
    caseKey: snapshot.caseKey,
    revisionKey,
    headSha: snapshot.headSha,
    modelId: snapshot.modelId,
    status: snapshot.status,
    events: snapshot.events,
    ...(snapshot.answer === undefined ? {} : { answer: snapshot.answer }),
    ...(pending === undefined ? {} : {
      pendingApproval: {
        approvalId: pending.approvalId,
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        argumentsHash: pending.argumentsHash,
        requestedAt: pending.requestedAt,
        expiresAt: pending.expiresAt,
      },
    }),
    createdAt: first.at,
    updatedAt: last.at,
  });
}
