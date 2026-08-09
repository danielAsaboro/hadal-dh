import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

import { parseCase } from "../../src/domain/serialization";
import { productEnv } from "../../src/config";
import { GitHubApi } from "../../src/github/api";
import { GitHubConnector } from "../../src/github/connector";

const token = productEnv(process.env, "GITHUB_TOKEN");
const repository = productEnv(process.env, "GITHUB_REPOSITORY");
const pullValue = productEnv(process.env, "GITHUB_PULL_NUMBER");
const caseFile = productEnv(process.env, "GITHUB_CASE_FILE");
const assignee = productEnv(process.env, "GITHUB_ASSIGNEE");
const enabled = productEnv(process.env, "GITHUB_LIVE") === "1"
  && token !== undefined
  && repository !== undefined
  && pullValue !== undefined
  && caseFile !== undefined
  && assignee !== undefined;

(enabled ? it : it.skip)("synchronizes work, review requests, actor identity, and status with a real GitHub pull request", async () => {
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
  await connector.syncApprovalRequests(value);
  await connector.syncApprovalRequests(value);
  await expect(connector.verifyActor(assignee as string)).resolves.toMatchObject({ login: assignee });
  const decisions = await connector.reconcileApprovals(value);
  if (productEnv(process.env, "GITHUB_REQUIRE_APPROVALS") === "1") {
    expect(new Set(decisions.map((decision) => decision.requirementKey)).size)
      .toBe(value.approvalRequirements.length);
  }
  await connector.publishAndVerifyStatus(
    value.revision.headSha,
    false,
    `https://github.com/${repository}/pull/${pullNumber}`,
  );
}, 60_000);
