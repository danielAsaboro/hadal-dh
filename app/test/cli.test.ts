import { describe, expect, it } from "vitest";

import { buildCli, exitCodeFor } from "../src/cli";
import { ConfigError } from "../src/config";
import { DataHubEvidenceError } from "../src/datahub/evidence";
import { GitHubConnectorError } from "../src/github/connector";
import { ValidationRunnerError } from "../src/validation/runner";

describe("Cutset CLI", () => {
  it("exposes the complete resumable case workflow", () => {
    const cases = buildCli().commands.find((command) => command.name() === "case");
    expect(cases?.commands.map((command) => command.name())).toEqual([
      "plan", "show", "map-owner", "sync-github", "reconcile", "approve",
      "generate", "validate", "decide",
    ]);
  });

  it("uses stable nonzero failure categories", () => {
    expect(exitCodeFor(new ConfigError("bad"))).toBe(2);
    expect(exitCodeFor(new DataHubEvidenceError("bad"))).toBe(3);
    expect(exitCodeFor(new GitHubConnectorError("bad"))).toBe(4);
    expect(exitCodeFor(new ValidationRunnerError("bad"))).toBe(5);
    expect(exitCodeFor(new Error("bad"))).toBe(1);
  });
});
