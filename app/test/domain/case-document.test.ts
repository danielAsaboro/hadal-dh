import { describe, expect, it } from "vitest";

import { caseDocumentTitle } from "../../src/domain/case-document";

describe("ChangeMarshal case document identity", () => {
  it("uses the canonical title without changing the stable case key", () => {
    const key = "a".repeat(24);
    expect(caseDocumentTitle(key)).toBe(`ChangeMarshal change case ${key}`);
  });
});
