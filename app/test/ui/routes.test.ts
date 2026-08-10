import { describe, expect, it } from "vitest";

import { parseAppRoute } from "../../src/ui/routes";

const caseKey = "a1b2c3d4e5f60718293a4b5c";

describe("ChangeMarshal application routes", () => {
  it("parses every approved global and case route without treating unknown paths as home", () => {
    expect(parseAppRoute("/")).toEqual({ kind: "landing" });
    expect(parseAppRoute("/workspace")).toEqual({ kind: "workspace", page: "home" });
    expect(parseAppRoute("/workspace/cases")).toEqual({ kind: "workspace", page: "cases" });
    expect(parseAppRoute("/workspace/work")).toEqual({ kind: "workspace", page: "work" });
    expect(parseAppRoute("/workspace/approvals")).toEqual({ kind: "workspace", page: "approvals" });

    for (const page of ["overview", "graph", "work", "approvals", "run", "history"] as const) {
      expect(parseAppRoute(`/workspace/cases/${caseKey}/${page}`)).toEqual({ kind: "case", caseKey, page });
    }

    expect(parseAppRoute("/pricing")).toEqual({ kind: "public-not-found" });
    expect(parseAppRoute("/workspace/unknown")).toEqual({ kind: "workspace-not-found" });
    expect(parseAppRoute(`/workspace/cases/${caseKey}/unknown`)).toEqual({ kind: "workspace-not-found" });
  });

  it("marks a bare valid case URL as a replace-only overview redirect", () => {
    expect(parseAppRoute(`/workspace/cases/${caseKey}`)).toEqual({
      kind: "case-redirect", caseKey, destination: `/workspace/cases/${caseKey}/overview`,
    });
  });

  it("rejects malformed and overlong case URLs instead of accepting another case", () => {
    expect(parseAppRoute("/workspace/cases/not-a-case/overview")).toEqual({ kind: "workspace-not-found" });
    expect(parseAppRoute(`/workspace/cases/${caseKey}/overview/extra`)).toEqual({ kind: "workspace-not-found" });
  });
});
