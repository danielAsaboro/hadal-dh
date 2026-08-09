import { describe, expect, it } from "vitest";

import type { ChangeCase } from "../../src/domain/case";
import { caseMarker, workKeysIn, workMarker } from "../../src/github/markers";

describe("ChangeMarshal GitHub markers", () => {
  it("writes canonical markers and reads both canonical and legacy work keys", () => {
    const key = "a".repeat(24);

    expect(workMarker(key)).toBe(`<!-- changemarshal-work-key:${key} -->`);
    expect(workKeysIn([
      `<!-- changemarshal-work-key:${key} -->`,
      `<!-- cutset-work-key:${"b".repeat(24)} -->`,
    ].join("\n"))).toEqual([key, "b".repeat(24)]);
  });

  it("uses the canonical product namespace for case markers", () => {
    const value = {
      caseKey: "a".repeat(24),
      revision: { revisionKey: "b".repeat(24), headSha: "head" },
    } as ChangeCase;

    expect(caseMarker(value)).toBe(
      `<!-- changemarshal-case:${value.caseKey};revision:${value.revision.revisionKey};head:head -->`,
    );
  });
});
