import { gunzipSync, gzipSync } from "node:zlib";

import { ChangeCaseSchema, type ChangeCase } from "./case";
import { caseContentHash, canonicalize, parseCase } from "./serialization";

const begin = "<!-- CHANGEMARSHAL_CASE_GZIP_BASE64_BEGIN -->";
const end = "<!-- CHANGEMARSHAL_CASE_GZIP_BASE64_END -->";
const legacyBegin = "<!-- CUTSET_CASE_GZIP_BASE64_BEGIN -->";
const legacyEnd = "<!-- CUTSET_CASE_GZIP_BASE64_END -->";
export const MAX_DATAHUB_DOCUMENT_CHARS = 7_900;

export function caseDocumentTitle(caseKey: string): string {
  if (!/^[a-f0-9]{24}$/.test(caseKey)) throw new Error("invalid ChangeMarshal case key");
  return `ChangeMarshal change case ${caseKey}`;
}

export function legacyCaseDocumentTitle(caseKey: string): string {
  if (!/^[a-f0-9]{24}$/.test(caseKey)) throw new Error("invalid legacy Cutset case key");
  return `Cutset change case ${caseKey}`;
}

export function isCaseDocumentTitle(title: unknown, caseKey: string): boolean {
  return title === caseDocumentTitle(caseKey) || title === legacyCaseDocumentTitle(caseKey);
}

export function sealCase(value: ChangeCase): ChangeCase {
  const { contentHash: _oldHash, ...content } = value;
  const unsealed = ChangeCaseSchema.parse(content);
  return ChangeCaseSchema.parse({ ...unsealed, contentHash: caseContentHash(unsealed) });
}

export function renderCaseDocument(value: ChangeCase): string {
  const sealed = sealCase(value);
  const canonical = JSON.stringify(canonicalize(sealed));
  const encoded = gzipSync(Buffer.from(canonical, "utf8"), { level: 9 }).toString("base64");
  const content = [
    "# Governed data change case",
    "",
    `- Case: \`${sealed.caseKey}\``,
    `- Revision: \`${sealed.revision.revisionKey}\``,
    `- Git head: \`${sealed.revision.headSha}\``,
    `- State: **${sealed.state}**`,
    `- Change: \`${sealed.change.modelName}.${sealed.change.oldName}\` → \`${sealed.change.newName}\``,
    `- Affected assets: ${sealed.evidence.assets.length}`,
    `- Required work items: ${sealed.workItems.length}`,
    `- Admission: ${sealed.admission?.allowed === true ? "allowed" : "blocked"}`,
    "",
    "The machine-verifiable canonical case below is gzip-compressed and base64-encoded to remain below DataHub MCP's verified document-read limit.",
    "",
    begin,
    encoded,
    end,
    "",
  ].join("\n");
  if (content.length > MAX_DATAHUB_DOCUMENT_CHARS) {
    throw new Error(`canonical case document exceeds ${MAX_DATAHUB_DOCUMENT_CHARS} characters`);
  }
  return content;
}

export function parseCaseDocument(content: string): ChangeCase {
  const matches = [[begin, end], [legacyBegin, legacyEnd]].flatMap(([opening, closing]) => {
    const start = content.indexOf(opening as string);
    const finish = content.indexOf(closing as string);
    return start >= 0
      && finish > start
      && start === content.lastIndexOf(opening as string)
      && finish === content.lastIndexOf(closing as string)
      ? [{ opening: opening as string, start, finish }]
      : [];
  });
  if (matches.length !== 1) {
    throw new Error("document omitted one unambiguous ChangeMarshal or legacy Cutset case envelope");
  }
  const match = matches[0] as { opening: string; start: number; finish: number };
  const encoded = content.slice(match.start + match.opening.length, match.finish).trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > MAX_DATAHUB_DOCUMENT_CHARS) {
    throw new Error("document contains an invalid ChangeMarshal case envelope");
  }
  try {
    const serialized = gunzipSync(Buffer.from(encoded, "base64"), {
      maxOutputLength: 2_000_000,
    }).toString("utf8");
    return parseCase(serialized);
  } catch (error) {
    throw new Error("document contains an unreadable ChangeMarshal case envelope", { cause: error });
  }
}
