import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { ChangeCase, DbtColumnRename, ImpactEvidence } from "../../src/domain/case";
import { parseCase } from "../../src/domain/serialization";
import {
  CasesService,
  CasesServiceError,
  type CaseStore,
  type EvidenceSource,
  type WorkSurface,
} from "../../src/application/cases";
import { AtomicCaseReplica } from "../../src/application/replica";

const execFile = promisify(execFileCallback);
const source = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";

function evidence(complete = true): ImpactEvidence {
  return {
    complete,
    source: { urn: source, type: "dataset", name: "customers" },
    schemaFields: ["email"], paths: [],
    assets: [{ urn: source, type: "dataset", name: "customers", owners: ["urn:li:corpuser:producer"], tags: [], glossaryTerms: [], incidentStatuses: [], assertions: [], queries: [], complete }],
  };
}

class CapturedEvidence implements EvidenceSource {
  constructor(readonly value: ImpactEvidence) {}
  async collect(_change: DbtColumnRename, _maxHops: number): Promise<ImpactEvidence> { return this.value; }
}

class VerifiedMemoryStore implements CaseStore {
  readonly values = new Map<string, ChangeCase>();
  readonly saves: ChangeCase[] = [];
  private document = "urn:li:document:case";
  async findCase(caseKey: string): Promise<string | undefined> {
    return this.values.has(caseKey) ? this.document : undefined;
  }
  async loadCase(_documentUrn: string): Promise<ChangeCase> {
    const value = [...this.values.values()][0];
    if (!value) throw new Error("not found");
    return value;
  }
  async saveAndVerifyCase(value: ChangeCase, verifiedAt: string): Promise<ChangeCase> {
    this.saves.push(value);
    const verified: ChangeCase = {
      ...value,
      dataHub: { verified: true, documentUrn: this.document, verifiedAt },
      contentHash: undefined,
    };
    this.values.set(value.caseKey, verified);
    return verified;
  }
}

async function gitRepository(): Promise<Readonly<{ root: string; base: string; head: string }>> {
  const root = await mkdtemp(join(tmpdir(), "changemarshal-cases-"));
  await execFile("git", ["init", "-q", root]);
  await execFile("git", ["-C", root, "config", "user.email", "changemarshal@example.com"]);
  await execFile("git", ["-C", root, "config", "user.name", "ChangeMarshal Tests"]);
  const path = join(root, "models.yml");
  await writeFile(path, "version: 2\nmodels:\n  - name: customers\n    columns:\n      - name: email\n", "utf8");
  await execFile("git", ["-C", root, "add", "models.yml"]);
  await execFile("git", ["-C", root, "commit", "-qm", "base"]);
  const base = (await execFile("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
  await writeFile(path, "version: 2\nmodels:\n  - name: customers\n    columns:\n      - name: email_address\n", "utf8");
  await execFile("git", ["-C", root, "add", "models.yml"]);
  await execFile("git", ["-C", root, "commit", "-qm", "rename"]);
  const head = (await execFile("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
  return { root, base, head };
}

describe("resumable case services", () => {
  it("plans from a real Git diff, persists policy, and writes a verified replica", async () => {
    const repo = await gitRepository();
    const store = new VerifiedMemoryStore();
    const replicaPath = join(repo.root, ".changemarshal", "case.json");
    const service = new CasesService(new CapturedEvidence(evidence()), store, new AtomicCaseReplica(replicaPath));

    const value = await service.plan({
      repoRoot: repo.root, repository: "acme/warehouse", baseRef: repo.base, headRef: repo.head,
      maxHops: 3, observedAt: "2026-08-09T10:00:00.000Z",
    });

    expect(value.change).toMatchObject({ oldName: "email", newName: "email_address" });
    expect(value.dataHub.verified).toBe(true);
    expect(value.admission?.blockers).not.toContain("DATAHUB_WRITEBACK_UNVERIFIED");
    expect(store.saves).toHaveLength(1);
    expect(parseCase(await readFile(replicaPath, "utf8")).caseKey).toBe(value.caseKey);
  });

  it("reruns the same case and invalidates facts when the head changes", async () => {
    const repo = await gitRepository();
    const store = new VerifiedMemoryStore();
    const service = new CasesService(new CapturedEvidence(evidence()), store);
    const first = await service.plan({
      repoRoot: repo.root, repository: "acme/warehouse", baseRef: repo.base, headRef: repo.head,
      maxHops: 3, observedAt: "2026-08-09T10:00:00.000Z",
    });
    const same = await service.plan({
      repoRoot: repo.root, repository: "acme/warehouse", baseRef: repo.base, headRef: repo.head,
      maxHops: 3, observedAt: "2026-08-09T10:05:00.000Z",
    });
    expect(same.caseKey).toBe(first.caseKey);
    expect(same.revision.revisionKey).toBe(first.revision.revisionKey);

    await writeFile(join(repo.root, "extra.txt"), "new revision\n", "utf8");
    await execFile("git", ["-C", repo.root, "add", "extra.txt"]);
    await execFile("git", ["-C", repo.root, "commit", "-qm", "new head"]);
    const newHead = (await execFile("git", ["-C", repo.root, "rev-parse", "HEAD"])).stdout.trim();
    const changed = await service.plan({
      repoRoot: repo.root, repository: "acme/warehouse", baseRef: repo.base, headRef: newHead,
      maxHops: 3, observedAt: "2026-08-09T10:10:00.000Z",
    });
    expect(changed.revision.revisionKey).not.toBe(first.revision.revisionKey);
    expect(changed.approvalDecisions).toEqual([]);
    expect(changed.validationReceipts).toEqual([]);
    expect(changed.externalProjections).toEqual([]);
  }, 15_000);

  it("prevents external work for incomplete evidence and preserves state on partial failure", async () => {
    const repo = await gitRepository();
    const store = new VerifiedMemoryStore();
    const service = new CasesService(new CapturedEvidence(evidence(false)), store);
    const value = await service.plan({
      repoRoot: repo.root, repository: "acme/warehouse", baseRef: repo.base, headRef: repo.head,
      maxHops: 3, observedAt: "2026-08-09T10:00:00.000Z",
    });
    let calls = 0;
    const surface: WorkSurface = {
      syncWork: async () => { calls += 1; throw new Error("partial remote failure"); },
      reconcileWork: async () => [],
      syncApprovalRequests: async () => { calls += 1; },
      reconcileApprovals: async () => [],
    };
    await expect(service.syncWork(value.caseKey, surface, "2026-08-09T10:05:00.000Z"))
      .rejects.toBeInstanceOf(CasesServiceError);
    expect(calls).toBe(0);
    expect(store.values.get(value.caseKey)?.externalProjections).toEqual([]);
  });

  it("requests reviews during synchronization and persists only reconciled GitHub reviews", async () => {
    const repo = await gitRepository();
    const store = new VerifiedMemoryStore();
    const service = new CasesService(new CapturedEvidence(evidence()), store);
    let value = await service.plan({
      repoRoot: repo.root, repository: "acme/warehouse", baseRef: repo.base, headRef: repo.head,
      maxHops: 3, observedAt: "2026-08-09T10:00:00.000Z",
    });
    value = await service.updateOwnerMappings(
      value.caseKey,
      [["urn:li:corpuser:producer", "producer-gh"]],
      "2026-08-09T10:01:00.000Z",
    );
    const requirement = value.approvalRequirements[0]!;
    let requests = 0;
    const surface: WorkSurface = {
      syncWork: async () => [],
      reconcileWork: async () => [],
      syncApprovalRequests: async () => { requests += 1; },
      reconcileApprovals: async () => [{
        requirementKey: requirement.requirementKey,
        revisionKey: value.revision.revisionKey,
        headSha: value.revision.headSha,
        role: requirement.role,
        ownerUrn: requirement.ownerUrn,
        actorLogin: "producer-gh",
        verdict: "approve",
        decidedAt: "2026-08-09T10:03:00.000Z",
        source: "github",
        externalId: "44",
        url: "https://github.com/acme/warehouse/pull/7#pullrequestreview-44",
      }],
    };

    await service.syncWork(value.caseKey, surface, "2026-08-09T10:02:00.000Z");
    const reconciled = await service.reconcileWork(value.caseKey, surface, "2026-08-09T10:04:00.000Z");

    expect(requests).toBe(1);
    expect(reconciled.approvalDecisions).toEqual([
      expect.objectContaining({ externalId: "44", actorLogin: "producer-gh", verdict: "approve" }),
    ]);
  });
});
