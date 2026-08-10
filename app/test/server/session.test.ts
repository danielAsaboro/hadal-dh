import { describe, expect, it } from "vitest";

import type { CaseApplication } from "../../src/server/app";
import { createServer } from "../../src/server/app";
import type { UiSessionConfig } from "../../src/server/session";

const session: UiSessionConfig = {
  passphrase: "operator-passphrase",
  signingSecret: "a signing secret that is long enough for test use",
  ttlSeconds: 3_600,
  secureCookie: true,
};

function application(): CaseApplication {
  return {
    list: async () => [],
    show: async () => { throw new Error("not used"); },
    syncWork: async () => { throw new Error("not used"); },
    reconcileWork: async () => { throw new Error("not used"); },
    updateOwnerMappings: async () => { throw new Error("not used"); },
    recordReceipt: async () => { throw new Error("not used"); },
    decide: async () => { throw new Error("not used"); },
  };
}

function cookieFrom(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("session response did not issue a cookie");
  return value.split(";", 1)[0] ?? "";
}

describe("operator sessions", () => {
  it.each([
    { method: "GET" as const, url: "/api/%63ases" },
    { method: "GET" as const, url: "/%61pi/cases" },
    { method: "POST" as const, url: `/api/%63ases/${"a".repeat(24)}/sync`, payload: {} },
    { method: "POST" as const, url: "/api/%61gent/runs/run-1/approvals/token-1", payload: { approved: true } },
  ])("rejects an unauthenticated encoded protected route: $method $url", async (request) => {
    const server = createServer({ application: application(), github: () => ({}) as never, session });
    try {
      const response = await server.inject(request);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    } finally {
      await server.close();
    }
  });

  it("rejects a wrong passphrase and allows configured API access only after a signed session", async () => {
    const server = createServer({ application: application(), github: () => ({}) as never, session });
    try {
      expect((await server.inject({ method: "GET", url: "/api/cases" })).statusCode).toBe(401);
      expect((await server.inject({ method: "GET", url: "/api/cases?probe=1" })).statusCode).toBe(401);
      expect((await server.inject({ method: "GET", url: "/api/agent/health?probe=1" })).statusCode).toBe(401);
      expect((await server.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ ok: true, service: "changemarshal" });
      expect((await server.inject({ method: "GET", url: "/api/session" })).json()).toEqual({ configured: true, authenticated: false });

      const wrong = await server.inject({ method: "POST", url: "/api/session", payload: { passphrase: "wrong" } });
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json()).toEqual({ error: "unauthorized" });

      const signedIn = await server.inject({ method: "POST", url: "/api/session", payload: { passphrase: session.passphrase } });
      expect(signedIn.statusCode).toBe(204);
      expect(signedIn.headers["set-cookie"]).toEqual(expect.stringMatching(/changemarshal_session=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600/));

      const cases = await server.inject({ method: "GET", url: "/api/cases", headers: { cookie: cookieFrom(signedIn.headers["set-cookie"]) } });
      expect(cases.statusCode).toBe(200);
      expect(cases.json()).toEqual([]);
      expect((await server.inject({ method: "GET", url: "/api/session", headers: { cookie: cookieFrom(signedIn.headers["set-cookie"]) } })).json()).toEqual({ configured: true, authenticated: true });
    } finally {
      await server.close();
    }
  });

  it("clears the session cookie on logout", async () => {
    const server = createServer({ application: application(), github: () => ({}) as never, session });
    try {
      const signedIn = await server.inject({ method: "POST", url: "/api/session", payload: { passphrase: session.passphrase } });
      const signedOut = await server.inject({ method: "DELETE", url: "/api/session", headers: { cookie: cookieFrom(signedIn.headers["set-cookie"]) } });

      expect(signedOut.statusCode).toBe(204);
      expect(signedOut.headers["set-cookie"]).toEqual(expect.stringMatching(/changemarshal_session=; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=0/));
      expect((await server.inject({ method: "GET", url: "/api/cases", headers: { cookie: "changemarshal_session=" } })).statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("preserves legacy API access when sessions are not configured", async () => {
    const server = createServer({ application: application(), github: () => ({}) as never });
    try {
      expect((await server.inject({ method: "GET", url: "/api/cases" })).statusCode).toBe(200);
      expect((await server.inject({ method: "GET", url: "/api/session" })).json()).toEqual({ configured: false, authenticated: true });
    } finally {
      await server.close();
    }
  });
});
