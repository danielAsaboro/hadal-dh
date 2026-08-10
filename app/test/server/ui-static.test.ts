import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createServer, type CaseApplication } from "../../src/server/app";

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

describe("production UI static routes", () => {
  it("serves the real index shell for direct workspace navigation", async () => {
    const uiRoot = await mkdtemp(join(tmpdir(), "changemarshal-ui-"));
    const shell = "<!doctype html><html><body><main>ChangeMarshal UI shell</main></body></html>";
    await writeFile(join(uiRoot, "index.html"), shell, "utf8");
    const server = createServer({ application: application(), github: () => ({}) as never, uiRoot });

    try {
      const response = await server.inject({ method: "GET", url: "/workspace" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toMatch(/^text\/html/);
      expect(response.body).toBe(shell);
    } finally {
      await server.close();
      await rm(uiRoot, { recursive: true, force: true });
    }
  });
});
