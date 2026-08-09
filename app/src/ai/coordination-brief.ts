import { generateText, Output, type LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

import type { ChangeCase } from "../domain/case";

const CoordinationBriefSchema = z.object({
  caseKey: z.string().regex(/^[a-f0-9]{24}$/),
  revisionKey: z.string().regex(/^[a-f0-9]{24}$/),
  summary: z.string().min(1),
  sequence: z.array(z.object({
    order: z.number().int().positive(),
    workKey: z.string().regex(/^[a-f0-9]{24}$/),
    action: z.string().min(1),
    validation: z.string().min(1),
  }).strict()),
  risks: z.array(z.object({
    affectedUrn: z.string().startsWith("urn:li:"),
    explanation: z.string().min(1),
  }).strict()),
}).strict();

export type CoordinationBrief = z.infer<typeof CoordinationBriefSchema>;

export class CoordinationBriefError extends Error {
  override readonly name = "CoordinationBriefError";
}

export function coordinationModel(config: Readonly<{ baseUrl: string; apiKey: string; model: string }>): LanguageModel {
  return createOpenAICompatible({
    name: "changemarshal",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    supportsStructuredOutputs: true,
  }).chatModel(config.model);
}

export function validateCoordinationBrief(value: ChangeCase, candidate: unknown): CoordinationBrief {
  const brief = CoordinationBriefSchema.parse(candidate);
  if (brief.caseKey !== value.caseKey || brief.revisionKey !== value.revision.revisionKey) {
    throw new CoordinationBriefError("AI brief does not reference the exact case revision");
  }
  const expectedWork = [...value.workItems.map((work) => work.workKey)].sort();
  const actualWork = [...brief.sequence.map((item) => item.workKey)].sort();
  if (JSON.stringify(actualWork) !== JSON.stringify(expectedWork)) {
    throw new CoordinationBriefError("AI brief must reference every required work item exactly once");
  }
  if (brief.sequence.some((item, index) => item.order !== index + 1)) {
    throw new CoordinationBriefError("AI brief sequence order must be consecutive and deterministic");
  }
  const knownUrns = new Set(value.evidence.assets.map((asset) => asset.urn));
  if (brief.risks.some((risk) => !knownUrns.has(risk.affectedUrn))) {
    throw new CoordinationBriefError("AI brief contains an unknown affected URN");
  }
  return brief;
}

export async function generateCoordinationBrief(
  value: ChangeCase,
  model: LanguageModel,
): Promise<CoordinationBrief> {
  if (!value.dataHub.verified || !value.evidence.complete) {
    throw new CoordinationBriefError("reread-verified DataHub evidence is required before AI planning");
  }
  const context = {
    caseKey: value.caseKey,
    revisionKey: value.revision.revisionKey,
    change: value.change,
    lineagePaths: value.evidence.paths,
    assets: value.evidence.assets,
    workItems: value.workItems,
    approvalRequirements: value.approvalRequirements,
  };
  const result = await generateText({
    model,
    output: Output.object({ schema: CoordinationBriefSchema }),
    timeout: { totalMs: 60_000, stepMs: 45_000 },
    instructions: [
      "You are ChangeMarshal's non-authoritative coordination planner.",
      "Use only the supplied DataHub URNs, work keys, requirements, and validation criteria.",
      "Include every work item exactly once. Never claim approval, validation, or merge authority.",
    ].join(" "),
    prompt: `Produce a concise multi-owner coordination brief from this verified case:\n${JSON.stringify(context)}`,
  });
  return validateCoordinationBrief(value, result.output);
}
