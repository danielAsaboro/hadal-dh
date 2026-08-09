import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readCommitTimestamp, readDiff, resolveRevision } from "../../src/git/repository";

const repositories: string[] = [];

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function repositoryWithRename(): string {
  const repo = mkdtempSync(join(tmpdir(), "changemarshal-ts-git-"));
  repositories.push(repo);
  git(repo, "init");
  git(repo, "config", "user.name", "ChangeMarshal Test");
  git(repo, "config", "user.email", "changemarshal@example.invalid");
  writeFileSync(
    join(repo, "customers.yml"),
    "models:\n  - name: customers\n    columns:\n      - name: email\n",
  );
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  writeFileSync(
    join(repo, "customers.yml"),
    "models:\n  - name: customers\n    columns:\n      - name: email_address\n",
  );
  git(repo, "add", ".");
  git(repo, "commit", "-m", "head");
  return repo;
}

afterEach(() => {
  for (const repository of repositories.splice(0)) rmSync(repository, { recursive: true });
});

describe("Git evidence", () => {
  it("resolves immutable revisions and reads the real dbt diff", async () => {
    const repo = repositoryWithRename();

    const head = await resolveRevision(repo, "HEAD");
    const diff = await readDiff(repo, "HEAD~1", "HEAD");

    expect(head).toMatch(/^[a-f0-9]{40}$/);
    expect(await readCommitTimestamp(repo, head)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(diff).toContain("-      - name: email");
    expect(diff).toContain("+      - name: email_address");
  });

  it("rejects a nonexistent revision without interpreting it as an option", async () => {
    const repo = repositoryWithRename();

    await expect(resolveRevision(repo, "--not-a-revision")).rejects.toThrow(
      /invalid Git revision/i,
    );
  });

  it("rejects a directory that is not a Git worktree", async () => {
    const directory = mkdtempSync(join(tmpdir(), "changemarshal-ts-not-git-"));
    repositories.push(directory);

    await expect(resolveRevision(directory, "HEAD")).rejects.toThrow(
      /not a Git repository/i,
    );
  });
});
