import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

import { parseCase } from "../../src/domain/serialization";
import { GitHubApi } from "../../src/github/api";
import { GitHubConnector } from "../../src/github/connector";

const token = process.env.CUTSET_GITHUB_TOKEN;
const repository = process.env.CUTSET_GITHUB_REPOSITORY;
const pullValue = process.env.CUTSET_GITHUB_PULL_NUMBER;
const caseFile = process.env.CUTSET_GITHUB_CASE_FILE;
const enabled = process.env.CUTSET_GITHUB_LIVE === "1"
  && token !== undefined
  && repository !== undefined
  && pullValue !== undefined
  && caseFile !== undefined;

(enabled ? it : it.skip)("idempotently synchronizes work with a real GitHub pull request", async () => {
  const pullNumber = Number(pullValue);
  if (!Number.isInteger(pullNumber) || pullNumber < 1) throw new Error("invalid live pull number");
  const value = parseCase(await readFile(caseFile as string, "utf8"));
  if (value.repository !== repository) throw new Error("live case repository does not match configuration");
  const connector = new GitHubConnector(
    new GitHubApi({ token: token as string }),
    repository as string,
    pullNumber,
  );
  const first = await connector.syncWork(value, new Date().toISOString());
  const second = await connector.syncWork(
    { ...value, externalProjections: first },
    new Date().toISOString(),
  );
  expect(second.map((item) => item.externalId).sort())
    .toEqual(first.map((item) => item.externalId).sort());
  expect(second.every((item) => item.state === "verified")).toBe(true);
}, 60_000);
