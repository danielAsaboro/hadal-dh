import { z } from "zod";

export const AgentRunStatusSchema = z.enum(["running", "waiting_for_approval", "completed", "failed"]);

export const AgentRunEventSchema = z.object({
  kind: z.enum([
    "run_started", "model_connected", "tool_proposed", "approval_required", "tool_approved",
    "tool_denied", "tool_started", "tool_completed", "tool_failed", "policy_evaluated",
    "external_reread_verified", "answer_emitted", "run_completed", "run_failed",
  ]),
  sequence: z.number().int().positive(),
  at: z.string().datetime(),
  summary: z.string().min(1).max(500),
  toolName: z.string().min(1).optional(),
  toolCallId: z.string().min(1).optional(),
  approvalId: z.string().min(1).optional(),
  argumentsHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  approved: z.boolean().optional(),
}).strict();

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
  pendingApproval: PendingAgentApprovalSchema.optional(),
}).strict();

export type AgentRunEvent = z.infer<typeof AgentRunEventSchema>;
export type AgentRunSnapshot = z.infer<typeof AgentRunSnapshotSchema>;
export type PendingAgentApproval = z.infer<typeof PendingAgentApprovalSchema>;
