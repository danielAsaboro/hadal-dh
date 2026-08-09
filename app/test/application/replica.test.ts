import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AtomicCaseReplica } from "../../src/application/replica";
import type { ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import { serializeCase } from "../../src/domain/serialization";

function value() {
  const source = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
  const evidence: ImpactEvidence = {
    complete: true,
    source: { urn: source, type: "dataset", name: "customers" },
    schemaFields: ["email"], paths: [],
    assets: [{ urn: source, type: "dataset", name: "customers", owners: ["urn:li:corpuser:owner"], tags: [], glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete: true }],
  };
  return compileCase(evidence, {
    repository: "acme/warehouse", baseSha: "base", headSha: "head", observedAt: "2026-08-09T10:00:00.000Z",
    change: { kind: "dbt_column_rename", modelName: "customers", oldName: "email", newName: "email_address", sourcePath: "models/schema.yml" },
  });
}

describe("local case replica rename compatibility", () => {
  it("moves the exact legacy .cutset replica to .changemarshal before saving", async () => {
    const root = await mkdtemp(join(tmpdir(), "changemarshal-replica-"));
    const legacy = join(root, ".cutset", "case.json");
    const canonical = join(root, ".changemarshal", "case.json");
    await mkdir(join(root, ".cutset"), { recursive: true });
    await writeFile(legacy, serializeCase(value()), "utf8");

    await new AtomicCaseReplica(canonical).save(value());

    expect(await readFile(canonical, "utf8")).toBe(serializeCase(value()));
    await expect(stat(legacy)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed when canonical and legacy replicas conflict", async () => {
    const root = await mkdtemp(join(tmpdir(), "changemarshal-replica-conflict-"));
    const legacy = join(root, ".cutset", "case.json");
    const canonical = join(root, ".changemarshal", "case.json");
    await mkdir(join(root, ".cutset"), { recursive: true });
    await mkdir(join(root, ".changemarshal"), { recursive: true });
    await writeFile(legacy, "legacy\n", "utf8");
    await writeFile(canonical, "canonical\n", "utf8");

    await expect(new AtomicCaseReplica(canonical).save(value())).rejects.toThrow(/conflicting.*replica/i);
  });
});
