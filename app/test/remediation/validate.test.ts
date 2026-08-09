import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ChangeCase, ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import {
  generateCompatibilityMigration,
  RemediationGenerationError,
} from "../../src/remediation/generate";
import { validateRemediation } from "../../src/remediation/validate";
import { writeRemediationArtifacts } from "../../src/remediation/write";

function value(): ChangeCase {
  const source = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
  const evidence: ImpactEvidence = {
    complete: true,
    source: { urn: source, type: "dataset", name: "analytics.customers" },
    schemaFields: ["customer_id", "email"], paths: [],
    assets: [{
      urn: source, type: "dataset", name: "analytics.customers", owners: ["urn:li:corpuser:producer"],
      tags: [], glossaryTerms: [], incidentStatuses: [],
      assertions: [{ urn: "urn:li:assertion:email-not-null", type: "FIELD_NOT_NULL", column: "email", status: "SUCCESS" }],
      queries: [{ urn: "urn:li:query:one", source: "SYSTEM", language: "SQL", name: null, statement: "SELECT email FROM customers WHERE customer_id = ?", subjects: [source] }],
      complete: true,
    }],
  };
  return compileCase(evidence, {
    repository: "acme/warehouse", baseSha: "base", headSha: "head", observedAt: "2026-08-09T10:00:00.000Z",
    change: { kind: "dbt_column_rename", modelName: "customers", oldName: "email", newName: "email_address", sourcePath: "models/customers.yml" },
  });
}

describe("grounded compatibility remediation", () => {
  it("generates deterministic SQL and dbt validation artifacts", () => {
    const generated = generateCompatibilityMigration(value());

    expect(generated.map((artifact) => artifact.relativePath)).toEqual([
      ".changemarshal/remediation/customers_compatibility.sql",
      ".changemarshal/remediation/customers_compatibility.yml",
    ]);
    expect(generated[0]?.content).toContain('"email_address" AS "email"');
    expect(generated[0]?.content).toContain("ref('customers')");
    expect(generated[1]?.content).toContain("not_null");
    expect(generated[0]?.content).toContain("ChangeMarshal case");
    expect(validateRemediation(value(), generated)).toEqual({ valid: true, errors: [] });
  });

  it("rejects unseen schema columns, unsafe identifiers, and altered output", () => {
    const current = value();
    expect(() => generateCompatibilityMigration({
      ...current,
      change: { ...current.change, oldName: "not_in_schema" },
    })).toThrow(/verified schema/i);
    expect(() => generateCompatibilityMigration({
      ...current,
      change: { ...current.change, newName: "email; drop table users" },
    })).toThrow(RemediationGenerationError);

    const generated = generateCompatibilityMigration(current);
    const altered = generated.map((artifact, index) => index === 0
      ? { ...artifact, content: `${artifact.content}\nDROP TABLE users;\n` }
      : artifact);
    expect(validateRemediation(current, altered)).toEqual({
      valid: false,
      errors: ["artifact content does not match grounded deterministic output: .changemarshal/remediation/customers_compatibility.sql"],
    });
  });

  it("migrates exact legacy generated artifacts and rejects conflicting dual paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "changemarshal-remediation-"));
    const generated = generateCompatibilityMigration(value());
    for (const artifact of generated) {
      const legacy = artifact.legacy;
      expect(legacy).toBeDefined();
      const target = join(root, legacy!.relativePath);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, legacy!.content, "utf8");
    }

    await writeRemediationArtifacts(root, generated);

    for (const artifact of generated) {
      expect(await readFile(join(root, artifact.relativePath), "utf8")).toBe(artifact.content);
      await expect(stat(join(root, artifact.legacy!.relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    }

    const first = generated[0]!;
    await mkdir(join(root, first.legacy!.relativePath, ".."), { recursive: true });
    await writeFile(join(root, first.legacy!.relativePath), "user changed legacy artifact\n", "utf8");
    await expect(writeRemediationArtifacts(root, generated)).rejects.toThrow(/conflicting legacy/i);
  });
});
