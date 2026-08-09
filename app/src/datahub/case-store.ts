import {
  type ChangeCase,
} from "../domain/case";
import {
  caseDocumentTitle,
  parseCaseDocument,
  renderCaseDocument,
  sealCase,
} from "../domain/case-document";
import { serializeCase } from "../domain/serialization";
import type { DataHubToolCaller } from "./evidence";
import { array, integer, record, text, urn } from "./normalize";

export class DataHubCaseStoreError extends Error {
  override readonly name = "DataHubCaseStoreError";
}

function storeError(error: unknown): DataHubCaseStoreError {
  if (error instanceof DataHubCaseStoreError) return error;
  return new DataHubCaseStoreError(
    error instanceof Error ? error.message : "unknown DataHub case-store error",
    { cause: error },
  );
}

export class DataHubCaseStore {
  constructor(private readonly tools: DataHubToolCaller) {}

  async findCase(caseKey: string): Promise<string | undefined> {
    try {
      const title = caseDocumentTitle(caseKey);
      const payload = record(await this.tools.callTool("search", {
        query: `/q "${title}"`,
        filter: "entity_type = document",
        num_results: 10,
        offset: 0,
      }), "document search response");
      const results = array(payload.searchResults, "document search results");
      const start = integer(payload.start, "document search start");
      const count = integer(payload.count, "document search count");
      const total = integer(payload.total, "document search total");
      if (start !== 0 || count !== results.length || total !== results.length) {
        throw new DataHubCaseStoreError("document search results are incomplete");
      }
      const exact = new Set<string>();
      for (const result of results) {
        const entity = record(record(result, "document result").entity, "document entity");
        const info = record(entity.info, "document info");
        if (info.title === title) exact.add(urn(entity.urn, "document"));
      }
      if (exact.size > 1) throw new DataHubCaseStoreError("multiple exact Cutset case documents exist");
      return [...exact][0];
    } catch (error) {
      throw storeError(error);
    }
  }

  async loadCase(documentUrn: string): Promise<ChangeCase> {
    try {
      const response = array(
        await this.tools.callTool("get_entities", { urns: [documentUrn] }),
        "document reread response",
      );
      if (response.length !== 1) throw new DataHubCaseStoreError("document reread did not return exactly one entity");
      const entity = record(response[0], "document entity");
      if (urn(entity.urn, "document") !== documentUrn || entity.error) {
        throw new DataHubCaseStoreError("document reread did not return the requested document");
      }
      const info = record(entity.info, "document info");
      const contents = record(info.contents, "document contents");
      if (contents._truncated === true) {
        throw new DataHubCaseStoreError("DataHub document reread was truncated");
      }
      const value = parseCaseDocument(text(contents.text, "document content"));
      if (info.title !== caseDocumentTitle(value.caseKey)) {
        throw new DataHubCaseStoreError("DataHub document title does not match its case key");
      }
      return value;
    } catch (error) {
      throw storeError(error);
    }
  }

  private async saveDocument(value: ChangeCase, existingUrn?: string): Promise<string> {
    const relatedAssets = [...new Set(value.evidence.assets.map((asset) => asset.urn))].sort();
    if (relatedAssets.length === 0 || relatedAssets.some((value) => !value.startsWith("urn:li:"))) {
      throw new DataHubCaseStoreError("case has no verified related assets");
    }
    const input: Record<string, unknown> = {
      document_type: "Analysis",
      title: caseDocumentTitle(value.caseKey),
      content: renderCaseDocument(value),
      topics: ["cutset", "governed-change", value.state],
      related_assets: relatedAssets,
    };
    if (existingUrn !== undefined) input.urn = existingUrn;
    const response = record(await this.tools.callTool("save_document", input), "save_document response");
    if (response.success !== true) throw new DataHubCaseStoreError("save_document did not succeed");
    const savedUrn = urn(response.urn, "saved document");
    if (!savedUrn.startsWith("urn:li:document:")) {
      throw new DataHubCaseStoreError("save_document returned a non-document URN");
    }
    if (existingUrn !== undefined && savedUrn !== existingUrn) {
      throw new DataHubCaseStoreError("save_document changed the existing document URN");
    }
    return savedUrn;
  }

  private async verifyExact(documentUrn: string, expected: ChangeCase): Promise<ChangeCase> {
    const loaded = await this.loadCase(documentUrn);
    if (
      loaded.caseKey !== expected.caseKey
      || loaded.revision.revisionKey !== expected.revision.revisionKey
      || loaded.contentHash !== expected.contentHash
      || serializeCase(loaded) !== serializeCase(expected)
    ) {
      throw new DataHubCaseStoreError("DataHub document reread did not match the saved case");
    }
    return loaded;
  }

  async saveAndVerifyCase(value: ChangeCase, verifiedAt: string): Promise<ChangeCase> {
    try {
      const existingUrn = await this.findCase(value.caseKey);
      const safeAdmission = value.admission === undefined
        ? undefined
        : {
            ...value.admission,
            allowed: false,
            blockers: [...new Set([...value.admission.blockers, "DATAHUB_WRITEBACK_UNVERIFIED"])].sort(),
          };
      const unverified = sealCase({
        ...value,
        ...(safeAdmission === undefined ? {} : { admission: safeAdmission }),
        ...(value.admission?.allowed === true ? { state: "approved" } : {}),
        dataHub: { verified: false },
      });
      const documentUrn = await this.saveDocument(unverified, existingUrn);
      await this.verifyExact(documentUrn, unverified);

      const verified = sealCase({
        ...value,
        dataHub: { verified: true, documentUrn, verifiedAt },
      });
      const stableUrn = await this.saveDocument(verified, documentUrn);
      if (stableUrn !== documentUrn) throw new DataHubCaseStoreError("verified update changed document identity");
      return await this.verifyExact(documentUrn, verified);
    } catch (error) {
      throw storeError(error);
    }
  }
}
