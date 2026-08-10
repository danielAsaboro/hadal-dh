export const casePages = ["overview", "graph", "work", "approvals", "run", "history"] as const;

export type CasePage = typeof casePages[number];
export type WorkspacePage = "home" | "cases" | "work" | "approvals";

export type AppRoute =
  | Readonly<{ kind: "landing" }>
  | Readonly<{ kind: "public-not-found" }>
  | Readonly<{ kind: "workspace"; page: WorkspacePage }>
  | Readonly<{ kind: "workspace-not-found" }>
  | Readonly<{ kind: "case"; caseKey: string; page: CasePage }>
  | Readonly<{ kind: "case-redirect"; caseKey: string; destination: string }>;

const caseKeyPattern = /^[a-f0-9]{24}$/;

function isCasePage(value: string): value is CasePage {
  return (casePages as readonly string[]).includes(value);
}

export function parseAppRoute(pathname: string): AppRoute {
  if (pathname === "/") return { kind: "landing" };
  if (pathname === "/workspace") return { kind: "workspace", page: "home" };
  if (pathname === "/workspace/cases") return { kind: "workspace", page: "cases" };
  if (pathname === "/workspace/work") return { kind: "workspace", page: "work" };
  if (pathname === "/workspace/approvals") return { kind: "workspace", page: "approvals" };

  const segments = pathname.split("/");
  if (segments.length === 4 && segments[1] === "workspace" && segments[2] === "cases" && caseKeyPattern.test(segments[3]!)) {
    const caseKey = segments[3]!;
    return { kind: "case-redirect", caseKey, destination: `/workspace/cases/${caseKey}/overview` };
  }
  if (segments.length === 5 && segments[1] === "workspace" && segments[2] === "cases" && caseKeyPattern.test(segments[3]!) && isCasePage(segments[4]!)) {
    return { kind: "case", caseKey: segments[3]!, page: segments[4]! };
  }
  if (pathname === "/workspace" || pathname.startsWith("/workspace/")) return { kind: "workspace-not-found" };
  return { kind: "public-not-found" };
}
