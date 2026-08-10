import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentCaseContext, createAgentOperations } from "../../src/ai/operations";
import type { CasesService, EvidenceSource, StatusSurface, WorkSurface } from "../../src/application/cases";
import { ChangeCaseSchema, type ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";

describe("agent operation context", () => {
  it("preserves current governed evidence while preventing recursive audit replay", () => {
    const source = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
    const evidence: ImpactEvidence = {
      complete: true,
      source: { urn: source, type: "dataset", name: "customers" },
      schemaFields: ["email"],
      paths: [],
      assets: [{
        urn: source, type: "dataset", name: "customers", owners: ["urn:li:corpuser:producer"],
        tags: [], glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete: true,
      }],
    };
    const base = compileCase(evidence, {
      repository: "owner/repo", baseSha: "a".repeat(40), headSha: "b".repeat(40),
      observedAt: "2026-08-10T00:00:00.000Z",
      change: { kind: "dbt_column_rename", modelName: "customers", oldName: "email", newName: "email_address", sourcePath: "models/schema.yml" },
    });
    const value = ChangeCaseSchema.parse({
      ...base,
      agentRuns: [{
        runId: "prior-run", caseKey: base.caseKey, revisionKey: base.revision.revisionKey,
        headSha: base.revision.headSha, modelId: "qwen3.6-27b", status: "completed",
        events: [{ kind: "run_started", sequence: 1, at: "2026-08-10T00:01:00.000Z", summary: "secret-shaped prior transcript" }],
        answer: "large prior model answer", createdAt: "2026-08-10T00:01:00.000Z", updatedAt: "2026-08-10T00:01:00.000Z",
      }],
    });

    const context = agentCaseContext(value);
    const serialized = JSON.stringify(context);

    expect(context.caseKey).toBe(value.caseKey);
    expect(context.evidence).toEqual(value.evidence);
    expect(context.audit).toEqual({ priorRunCount: 1, latestRunStatus: "completed" });
    expect(serialized).not.toContain("secret-shaped prior transcript");
    expect(serialized).not.toContain("large prior model answer");
    expect(serialized).not.toContain("contentHash");
  });

  it("refuses remediation when the live checkout moves after the agent starts", async () => {
    const root = mkdtempSync(join(tmpdir(), "changemarshal-operation-scope-"));
    try {
      execFileSync("git", ["init", "--quiet", root]);
      execFileSync("git", ["-C", root, "config", "user.email", "scope@example.invalid"]);
      execFileSync("git", ["-C", root, "config", "user.name", "Scope Test"]);
      writeFileSync(join(root, "schema.yml"), "email: string\n");
      execFileSync("git", ["-C", root, "add", "schema.yml"]);
      execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "base"]);
      const baseSha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      writeFileSync(join(root, "schema.yml"), "email_address: string\n");
      execFileSync("git", ["-C", root, "add", "schema.yml"]);
      execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "governed head"]);
      const headSha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const source = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
      const value = compileCase({
        complete: true, source: { urn: source, type: "dataset", name: "customers" }, schemaFields: ["email"], paths: [],
        assets: [{
          urn: source, type: "dataset", name: "customers", owners: ["urn:li:corpuser:producer"], tags: [],
          glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete: true,
        }],
      }, {
        repository: "owner/repo", baseSha, headSha, observedAt: "2026-08-10T00:00:00.000Z",
        change: { kind: "dbt_column_rename", modelName: "customers", oldName: "email", newName: "email_address", sourcePath: "schema.yml" },
      });
      writeFileSync(join(root, "README.md"), "moved\n");
      execFileSync("git", ["-C", root, "add", "README.md"]);
      execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "moved checkout"]);
      const forbidden = async () => { throw new Error("not used"); };
      const operations = createAgentOperations({
        scope: {
          repoRoot: root, repository: value.repository, baseRef: baseSha, headRef: headSha,
          targetUrl: "https://example.invalid/case", maxHops: 3, ownerMappings: [], validationCommand: [], artifactPaths: [],
        },
        evidence: { collect: forbidden } as unknown as EvidenceSource,
        service: { show: async () => value } as unknown as CasesService,
        workSurface: {} as WorkSurface,
        statusSurface: {} as StatusSurface,
      });

      await expect(operations.generateRemediation(value.caseKey))
        .rejects.toThrow(/repository HEAD changed/i);
      expect(existsSync(join(root, ".changemarshal"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
