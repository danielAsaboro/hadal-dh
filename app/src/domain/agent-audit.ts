import { z } from "zod";

const nonEmpty = z.string().min(1);
const stableKey = z.string().regex(/^[a-f0-9]{24}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime();

export const AgentRunStatusSchema = z.enum(["running", "waiting_for_approval", "completed", "failed"]);

export const AgentRunEventSchema = z.object({
  kind: z.enum([
    "run_started", "model_connected", "tool_proposed", "approval_required", "tool_approved",
    "tool_denied", "tool_started", "tool_completed", "tool_failed", "policy_evaluated",
    "external_reread_verified", "answer_emitted", "run_completed", "run_failed",
  ]),
  sequence: z.number().int().positive(),
  at: timestamp,
  summary: nonEmpty.max(500),
  toolName: nonEmpty.optional(),
  toolCallId: nonEmpty.optional(),
  approvalId: nonEmpty.optional(),
  argumentsHash: sha256.optional(),
  approved: z.boolean().optional(),
}).strict().readonly();

export const DurablePendingAgentApprovalSchema = z.object({
  approvalId: nonEmpty,
  toolCallId: nonEmpty,
  toolName: nonEmpty,
  argumentsHash: sha256,
  requestedAt: timestamp,
  expiresAt: timestamp,
}).strict().readonly();

export const DurableAgentRunSchema = z.object({
  runId: nonEmpty,
  caseKey: stableKey,
  revisionKey: stableKey,
  headSha: nonEmpty,
  modelId: nonEmpty,
  status: AgentRunStatusSchema,
  events: z.array(AgentRunEventSchema).min(1).readonly(),
  answer: nonEmpty.max(20_000).optional(),
  pendingApproval: DurablePendingAgentApprovalSchema.optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict().superRefine((value, context) => {
  if (value.events.some((event, index) => event.sequence !== index + 1)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "agent run events must have a contiguous sequence" });
  }
  if ((value.status === "waiting_for_approval") !== (value.pendingApproval !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "pending approval must match waiting run status" });
  }
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "agent run update cannot precede creation" });
  }
}).readonly();

export type AgentRunEvent = z.infer<typeof AgentRunEventSchema>;
export type DurableAgentRun = z.infer<typeof DurableAgentRunSchema>;
