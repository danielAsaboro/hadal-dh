import { describe, expect, it } from "vitest";

import type { ImpactEvidence } from "../../src/domain/case";
import { compileCase } from "../../src/domain/compile-case";
import {
  DataHubCaseStore,
  DataHubCaseStoreError,
} from "../../src/datahub/case-store";
import type { DataHubToolCaller } from "../../src/datahub/evidence";

const source = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
const consumer = "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.orders,PROD)";
const documentUrn = "urn:li:document:cutset-governed-case";

function changeCase() {
  const context = (urn: string, name: string, owner: string) => ({
    urn, type: "dataset", name, owners: [owner], tags: [], glossaryTerms: [],
    incidentStatuses: [], assertions: [], queries: [], complete: true,
  });
  const evidence: ImpactEvidence = {
    complete: true,
    source: { urn: source, type: "dataset", name: "customers" },
    schemaFields: ["email"],
    paths: [{ sourceUrn: source, downstreamUrn: consumer, column: "email", downstreamColumns: ["email"], nodes: [source, consumer] }],
    assets: [
      context(source, "customers", "urn:li:corpuser:producer"),
      context(consumer, "orders", "urn:li:corpuser:consumer"),
    ],
  };
  return compileCase(evidence, {
    repository: "acme/warehouse",
    baseSha: "base",
    headSha: "head",
    observedAt: "2026-08-09T10:00:00.000Z",
    change: {
      kind: "dbt_column_rename", modelName: "customers", oldName: "email",
      newName: "email_address", sourcePath: "models/schema.yml",
    },
  });
}

class CapturedDocumentService implements DataHubToolCaller {
  readonly documents = new Map<string, { title: string; content: string }>();
  readonly saves: Readonly<Record<string, unknown>>[] = [];
  failSave = false;
  truncateRead = false;

  async callTool(name: string, input: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (name === "search") {
      const results = [...this.documents.entries()].map(([urn, document]) => ({
        entity: { urn, info: { title: document.title } },
      }));
      return { start: 0, count: results.length, total: results.length, searchResults: results, facets: [] };
    }
    if (name === "save_document") {
      this.saves.push(input);
      if (this.failSave) return { success: false, urn: null, message: "denied", author: null };
      const urn = typeof input.urn === "string" ? input.urn : documentUrn;
      this.documents.set(urn, { title: String(input.title), content: String(input.content) });
      return { success: true, urn, message: "saved", author: "Cutset" };
    }
    if (name === "get_entities") {
      const urns = input.urns as readonly string[];
      return urns.flatMap((urn) => {
        const document = this.documents.get(urn);
        if (!document) return [];
        return [{
          urn,
          type: "DOCUMENT",
          info: {
            title: document.title,
            contents: {
              text: this.truncateRead ? `${document.content.slice(0, 20)}...` : document.content,
              ...(this.truncateRead ? { _truncated: true, _originalLengthChars: document.content.length } : {}),
            },
          },
        }];
      });
    }
    throw new Error(`unexpected tool call: ${name}`);
  }
}

describe("DataHub case persistence", () => {
  it("creates, rereads, seals, and updates one stable document", async () => {
    const service = new CapturedDocumentService();
    const store = new DataHubCaseStore(service);
    const first = await store.saveAndVerifyCase(changeCase(), "2026-08-09T10:05:00.000Z");
    const second = await store.saveAndVerifyCase(first, "2026-08-09T10:10:00.000Z");

    expect(first.dataHub).toEqual({
      verified: true, documentUrn, verifiedAt: "2026-08-09T10:05:00.000Z",
    });
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.dataHub.documentUrn).toBe(documentUrn);
    expect(service.documents.size).toBe(1);
    expect(service.saves).toHaveLength(4);
    expect(service.saves[0]?.related_assets).toEqual([source, consumer].sort());
    expect(service.saves.slice(1).every((save) => save.urn === documentUrn)).toBe(true);
    expect(await store.findCase(first.caseKey)).toBe(documentUrn);
    expect((await store.loadCase(documentUrn)).contentHash).toBe(second.contentHash);
  });

  it("rejects incomplete search and duplicate exact documents before mutation", async () => {
    const value = changeCase();
    const incomplete: DataHubToolCaller = {
      callTool: async () => ({ start: 0, count: 0, total: 1, searchResults: [], facets: [] }),
    };
    await expect(new DataHubCaseStore(incomplete).saveAndVerifyCase(value, "2026-08-09T10:05:00.000Z"))
      .rejects.toThrow(/search.*incomplete/i);

    const duplicate = new CapturedDocumentService();
    const title = `Cutset change case ${value.caseKey}`;
    duplicate.documents.set("urn:li:document:first", { title, content: "first" });
    duplicate.documents.set("urn:li:document:second", { title, content: "second" });
    await expect(new DataHubCaseStore(duplicate).saveAndVerifyCase(value, "2026-08-09T10:05:00.000Z"))
      .rejects.toThrow(/multiple.*documents/i);
    expect(duplicate.saves).toEqual([]);
  });

  it("does not update fuzzy title matches", async () => {
    const service = new CapturedDocumentService();
    service.documents.set("urn:li:document:unrelated", {
      title: "Cutset change case for something else",
      content: "unrelated",
    });

    const saved = await new DataHubCaseStore(service)
      .saveAndVerifyCase(changeCase(), "2026-08-09T10:05:00.000Z");

    expect(saved.dataHub.documentUrn).toBe(documentUrn);
    expect(service.documents.size).toBe(2);
    expect(service.saves[0]).not.toHaveProperty("urn");
  });

  it("rejects mutation failure and truncated or mismatched rereads", async () => {
    const failed = new CapturedDocumentService();
    failed.failSave = true;
    await expect(new DataHubCaseStore(failed).saveAndVerifyCase(changeCase(), "2026-08-09T10:05:00.000Z"))
      .rejects.toThrow(/save_document did not succeed/i);

    const truncated = new CapturedDocumentService();
    truncated.truncateRead = true;
    await expect(new DataHubCaseStore(truncated).saveAndVerifyCase(changeCase(), "2026-08-09T10:05:00.000Z"))
      .rejects.toThrow(/truncated/i);

    const mismatched: DataHubToolCaller = {
      callTool: async (name, input) => {
        if (name === "search") return { start: 0, count: 0, total: 0, searchResults: [], facets: [] };
        if (name === "save_document") return { success: true, urn: documentUrn, message: "saved", author: "Cutset" };
        if (name === "get_entities") return [{
          urn: documentUrn,
          info: { title: String(input.title ?? "wrong"), contents: { text: "not a Cutset case" } },
        }];
        throw new Error(name);
      },
    };
    await expect(new DataHubCaseStore(mismatched).saveAndVerifyCase(changeCase(), "2026-08-09T10:05:00.000Z"))
      .rejects.toBeInstanceOf(DataHubCaseStoreError);
  });
});
