import {
  type ChangeCase,
} from "../domain/case";
import {
  caseDocumentTitle,
  formerCaseDocumentTitle,
  isCaseDocumentTitle,
  legacyCaseDocumentTitle,
  MAX_DATAHUB_DOCUMENT_CHARS,
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

function stableCaseUrn(caseKey: string): string {
  // This stable URN predates the public Hadal rename. Changing it would split
  // canonical DataHub records, so Hadal keeps it as an identity, not branding.
  return `urn:li:document:changemarshal-change-case-${caseKey}`;
}

export class DataHubCaseStore {
  constructor(private readonly tools: DataHubToolCaller) {}

  private async findCaseMatch(caseKey: string): Promise<Readonly<{ urn: string; title: string }> | undefined> {
    try {
      const titles = new Set([caseDocumentTitle(caseKey), formerCaseDocumentTitle(caseKey), legacyCaseDocumentTitle(caseKey)]);
      const payload = record(await this.tools.callTool("search_documents", {
        query: `/q "change case ${caseKey}"`,
        num_results: 10,
        offset: 0,
      }), "document search response");
      const start = integer(payload.start, "document search start");
      const total = integer(payload.total, "document search total");
      const results = payload.searchResults === undefined && total === 0
        ? []
        : array(payload.searchResults, "document search results");
      const count = payload.count === undefined && total === 0
        ? 0
        : integer(payload.count, "document search count");
      if (start !== 0 || results.length > count || total !== results.length) {
        throw new DataHubCaseStoreError("document search results are incomplete");
      }
      const exact = new Map<string, string>();
      for (const result of results) {
        const entity = record(record(result, "document result").entity, "document entity");
        const entityUrn = urn(entity.urn, "document");
        const info = record(entity.info, "document info");
        if (titles.has(String(info.title))) exact.set(entityUrn, String(info.title));
      }
      if (exact.size > 1) throw new DataHubCaseStoreError("multiple exact Hadal, ChangeMarshal, or legacy Cutset case documents exist");
      const match = [...exact][0];
      return match === undefined ? undefined : { urn: match[0], title: match[1] };
    } catch (error) {
      throw storeError(error);
    }
  }

  async findCase(caseKey: string): Promise<string | undefined> {
    const indexed = await this.findCaseMatch(caseKey);
    if (indexed !== undefined) return indexed.urn;
    const intendedUrn = stableCaseUrn(caseKey);
    try {
      const value = await this.loadCase(intendedUrn);
      if (value.caseKey !== caseKey) throw new DataHubCaseStoreError("stable document URN does not match its case key");
      return intendedUrn;
    } catch (error) {
      if (error instanceof DataHubCaseStoreError && error.message === "document reread did not return exactly one document") {
        return undefined;
      }
      throw error;
    }
  }

  async listCases(): Promise<readonly ChangeCase[]> {
    try {
      const found = new Map<string, string>();
      let offset = 0;
      let total = 0;
      do {
        const payload = record(await this.tools.callTool("search_documents", {
          query: "/q \"change case\"",
          num_results: 50,
          offset,
        }), "case index response");
        const start = integer(payload.start, "case index start");
        total = integer(payload.total, "case index total");
        const results = payload.searchResults === undefined && total === 0
          ? []
          : array(payload.searchResults, "case index results");
        const count = payload.count === undefined && total === 0
          ? 0
          : integer(payload.count, "case index count");
        if (start !== offset || results.length > count || offset + results.length > total || (results.length === 0 && offset < total)) {
          throw new DataHubCaseStoreError("case index pagination is incomplete");
        }
        for (const result of results) {
          const entity = record(record(result, "case index result").entity, "case index entity");
          const title = record(entity.info, "case index info").title;
          const match = typeof title === "string"
            ? /^(?:Hadal|ChangeMarshal|Cutset) change case ([a-f0-9]{24})$/.exec(title)
            : null;
          if (match?.[1]) {
            const documentUrn = urn(entity.urn, "case document");
            if (found.has(match[1]) && found.get(match[1]) !== documentUrn) {
              throw new DataHubCaseStoreError(`multiple exact Hadal, ChangeMarshal, or legacy Cutset case documents exist: ${match[1]}`);
            }
            found.set(match[1], documentUrn);
          }
        }
        offset += results.length;
      } while (offset < total);
      const values: ChangeCase[] = [];
      for (const [caseKey, documentUrn] of [...found].sort(([left], [right]) => left.localeCompare(right))) {
        const value = await this.loadCase(documentUrn);
        if (value.caseKey !== caseKey) throw new DataHubCaseStoreError("case index title does not match document content");
        values.push(value);
      }
      return values;
    } catch (error) {
      throw storeError(error);
    }
  }

  async loadCase(documentUrn: string): Promise<ChangeCase> {
    try {
      const response = record(await this.tools.callTool("grep_documents", {
        urns: [documentUrn],
        pattern: "^# Governed data change case",
        context_chars: MAX_DATAHUB_DOCUMENT_CHARS,
        max_matches_per_doc: 1,
        start_offset: 0,
      }), "document reread response");
      const results = array(response.results, "document reread results");
      if (
        integer(response.documents_with_matches, "documents with matches") !== 1
        || integer(response.total_matches, "document matches") !== 1
        || results.length !== 1
      ) {
        throw new DataHubCaseStoreError("document reread did not return exactly one document");
      }
      const entity = record(results[0], "document result");
      if (urn(entity.urn, "document") !== documentUrn) {
        throw new DataHubCaseStoreError("document reread did not return the requested document");
      }
      const matches = array(entity.matches, "document excerpts");
      if (matches.length !== 1 || integer(record(matches[0], "document excerpt").position, "document match position") !== 0) {
        throw new DataHubCaseStoreError("DataHub document reread was incomplete");
      }
      const content = text(record(matches[0], "document excerpt").excerpt, "document content");
      let value: ChangeCase;
      try {
        value = parseCaseDocument(content);
      } catch (error) {
        throw new DataHubCaseStoreError("DataHub document reread was truncated or invalid", { cause: error });
      }
      if (!isCaseDocumentTitle(entity.title, value.caseKey)) {
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
      topics: ["hadal", "governed-change", value.state],
      related_assets: relatedAssets,
    };
    // DataHub's document search index is eventually consistent. A stable, case-key-derived
    // identity prevents an immediate rerun (or another process) from creating a duplicate
    // before the canonical title becomes searchable. Existing random/legacy URNs discovered
    // above remain authoritative and are updated in place.
    const intendedUrn = existingUrn ?? stableCaseUrn(value.caseKey);
    input.urn = intendedUrn;
    const response = record(await this.tools.callTool("save_document", input), "save_document response");
    if (response.success !== true) throw new DataHubCaseStoreError("save_document did not succeed");
    const savedUrn = urn(response.urn, "saved document");
    if (!savedUrn.startsWith("urn:li:document:")) {
      throw new DataHubCaseStoreError("save_document returned a non-document URN");
    }
    if (savedUrn !== intendedUrn) {
      throw new DataHubCaseStoreError("save_document changed the intended document URN");
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
      const existingMatch = await this.findCaseMatch(value.caseKey);
      const existingUrn = existingMatch?.urn;
      if (existingUrn !== undefined) {
        const existing = await this.loadCase(existingUrn);
        const intended = sealCase({
          ...value,
          dataHub: { verified: true, documentUrn: existingUrn, verifiedAt },
        });
        if (serializeCase(existing) === serializeCase(intended)) {
          if (existingMatch?.title === caseDocumentTitle(value.caseKey)) return existing;
          const migratedUrn = await this.saveDocument(intended, existingUrn);
          return await this.verifyExact(migratedUrn, intended);
        }
      }
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
