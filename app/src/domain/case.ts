import { z } from "zod";

const nonEmpty = z.string().min(1);
const urn = z.string().startsWith("urn:li:");
const isoTimestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const stableKey = z.string().regex(/^[a-f0-9]{24}$/);

export const WorkKind = {
  ProducerMigration: "producer_migration",
  ConsumerAcknowledgement: "consumer_acknowledgement",
  MlValidation: "ml_validation",
} as const;

export const ApprovalRole = {
  Producer: "producer",
  Consumer: "consumer",
} as const;

export const ApprovalVerdict = {
  Approve: "approve",
  Reject: "reject",
} as const;

export const ProjectionState = {
  Pending: "pending",
  Verified: "verified",
  Error: "error",
} as const;

export const CaseState = {
  Draft: "draft",
  BlockedContext: "blocked_context",
  Planned: "planned",
  InProgress: "in_progress",
  BlockedOwnership: "blocked_ownership",
  BlockedApproval: "blocked_approval",
  BlockedValidation: "blocked_validation",
  Ready: "ready",
  Stale: "stale",
  Approved: "approved",
  Resolved: "resolved",
} as const;

export const DbtColumnRenameSchema = z
  .object({
    kind: z.literal("dbt_column_rename"),
    modelName: nonEmpty,
    oldName: nonEmpty,
    newName: nonEmpty,
    sourcePath: nonEmpty,
  })
  .strict()
  .readonly();

export type DbtColumnRename = z.infer<typeof DbtColumnRenameSchema>;

export const EvidenceAssetSchema = z
  .object({ urn, type: nonEmpty, name: nonEmpty })
  .strict()
  .readonly();

const QuerySchema = z
  .object({
    urn,
    source: nonEmpty,
    language: nonEmpty,
    name: z.string().nullable(),
    statement: z.string(),
    subjects: z.array(urn).readonly(),
  })
  .strict()
  .readonly();

const AssertionSchema = z
  .object({
    urn,
    type: nonEmpty,
    column: z.string().nullable(),
    status: nonEmpty,
  })
  .strict()
  .readonly();

const AssetContextSchema = z
  .object({
    urn,
    type: nonEmpty,
    name: nonEmpty,
    owners: z.array(urn).readonly(),
    tags: z.array(urn).readonly(),
    glossaryTerms: z.array(urn).readonly(),
    incidentStatuses: z.array(nonEmpty).readonly(),
    assertions: z.array(AssertionSchema).readonly(),
    queries: z.array(QuerySchema).readonly(),
    complete: z.boolean(),
  })
  .strict()
  .readonly();

const LineagePathSchema = z
  .object({
    sourceUrn: urn,
    downstreamUrn: urn,
    column: nonEmpty,
    downstreamColumns: z.array(nonEmpty).readonly(),
    nodes: z.array(urn).min(1).readonly(),
  })
  .strict()
  .readonly();

export const ImpactEvidenceSchema = z
  .object({
    complete: z.boolean(),
    source: EvidenceAssetSchema,
    schemaFields: z.array(nonEmpty).readonly(),
    paths: z.array(LineagePathSchema).readonly(),
    assets: z.array(AssetContextSchema).readonly(),
  })
  .strict()
  .readonly();

const CaseRevisionSchema = z
  .object({
    revisionKey: stableKey,
    baseSha: nonEmpty,
    headSha: nonEmpty,
    evidenceFingerprint: sha256,
    createdAt: isoTimestamp,
  })
  .strict()
  .readonly();

const WorkItemSchema = z
  .object({
    workKey: stableKey,
    revisionKey: stableKey,
    kind: z.enum([
      WorkKind.ProducerMigration,
      WorkKind.ConsumerAcknowledgement,
      WorkKind.MlValidation,
    ]),
    ownerUrn: urn,
    affectedUrns: z.array(urn).min(1).readonly(),
    lineagePathIndexes: z.array(z.number().int().nonnegative()).readonly(),
    title: nonEmpty,
    completionCriteria: z.array(nonEmpty).min(1).readonly(),
  })
  .strict()
  .readonly();

const ApprovalRequirementSchema = z
  .object({
    requirementKey: stableKey,
    revisionKey: stableKey,
    role: z.enum([ApprovalRole.Producer, ApprovalRole.Consumer]),
    ownerUrn: urn,
    affectedUrns: z.array(urn).min(1).readonly(),
  })
  .strict()
  .readonly();

const ApprovalDecisionSchema = z
  .object({
    requirementKey: stableKey,
    revisionKey: stableKey,
    headSha: nonEmpty,
    role: z.enum([ApprovalRole.Producer, ApprovalRole.Consumer]),
    ownerUrn: urn,
    actorLogin: nonEmpty,
    verdict: z.enum([ApprovalVerdict.Approve, ApprovalVerdict.Reject]),
    decidedAt: isoTimestamp,
    source: z.literal("github"),
  })
  .strict()
  .readonly();

const ValidationReceiptSchema = z
  .object({
    receiptKey: stableKey,
    workKey: stableKey,
    revisionKey: stableKey,
    headSha: nonEmpty,
    command: z.array(nonEmpty).min(1).readonly(),
    exitCode: z.number().int(),
    stdoutSha256: sha256,
    stderrSha256: sha256,
    artifactHashes: z.array(z.tuple([nonEmpty, sha256])).readonly(),
    startedAt: isoTimestamp,
    finishedAt: isoTimestamp,
    valid: z.boolean(),
  })
  .strict()
  .readonly();

const ExternalProjectionSchema = z
  .object({
    system: z.literal("github"),
    workKey: stableKey,
    externalId: nonEmpty,
    url: z.string().url(),
    state: z.enum([
      ProjectionState.Pending,
      ProjectionState.Verified,
      ProjectionState.Error,
    ]),
    revisionKey: stableKey,
    headSha: nonEmpty,
    assignee: nonEmpty,
    verifiedAt: isoTimestamp.nullable(),
  })
  .strict()
  .readonly();

const AdmissionDecisionSchema = z
  .object({
    allowed: z.boolean(),
    blockers: z.array(nonEmpty).readonly(),
    revisionKey: stableKey,
    headSha: nonEmpty,
    evaluatedAt: isoTimestamp,
  })
  .strict()
  .readonly();

const DataHubPersistenceSchema = z
  .object({
    verified: z.boolean(),
    documentUrn: urn.optional(),
    verifiedAt: isoTimestamp.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.verified && (!value.documentUrn || !value.verifiedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "verified DataHub persistence requires documentUrn and verifiedAt",
      });
    }
  })
  .readonly();

export const ChangeCaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    caseKey: stableKey,
    repository: nonEmpty,
    change: DbtColumnRenameSchema,
    evidence: ImpactEvidenceSchema,
    revision: CaseRevisionSchema,
    state: z.enum(Object.values(CaseState) as [string, ...string[]]),
    workItems: z.array(WorkItemSchema).readonly(),
    approvalRequirements: z.array(ApprovalRequirementSchema).readonly(),
    approvalDecisions: z.array(ApprovalDecisionSchema).readonly(),
    validationReceipts: z.array(ValidationReceiptSchema).readonly(),
    externalProjections: z.array(ExternalProjectionSchema).readonly(),
    admission: AdmissionDecisionSchema.optional(),
    ownerMappings: z.array(z.tuple([urn, nonEmpty])).readonly(),
    dataHub: DataHubPersistenceSchema,
    contentHash: sha256.optional(),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
  .strict()
  .superRefine((value, context) => {
    const revisionKey = value.revision.revisionKey;
    const nestedRevisionKeys = [
      ...value.workItems.map((item) => item.revisionKey),
      ...value.approvalRequirements.map((item) => item.revisionKey),
      ...value.approvalDecisions.map((item) => item.revisionKey),
      ...value.validationReceipts.map((item) => item.revisionKey),
      ...value.externalProjections.map((item) => item.revisionKey),
    ];
    if (nestedRevisionKeys.some((key) => key !== revisionKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "nested case facts must reference the current revision",
      });
    }
    if (new Set(value.workItems.map((item) => item.workKey)).size !== value.workItems.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate work keys" });
    }
  })
  .readonly();

export type ChangeCase = z.infer<typeof ChangeCaseSchema>;
