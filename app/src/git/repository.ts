import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const maxBuffer = 8 * 1024 * 1024;

export class GitContextError extends Error {
  override readonly name = "GitContextError";
}

async function runGit(repo: string, args: readonly string[]): Promise<string> {
  try {
    const result = await runFile("git", [...args], {
      cwd: repo,
      encoding: "utf8",
      maxBuffer,
      windowsHide: true,
    });
    return result.stdout;
  } catch (error) {
    throw new GitContextError("Git context command failed", { cause: error });
  }
}

async function verifyRepository(repo: string): Promise<void> {
  try {
    const result = await runGit(repo, ["rev-parse", "--is-inside-work-tree"]);
    if (result.trim() !== "true") throw new Error("outside worktree");
  } catch (error) {
    throw new GitContextError(`not a Git repository: ${repo}`, { cause: error });
  }
}

async function verifyRevision(repo: string, revision: string): Promise<void> {
  if (!revision) throw new GitContextError("invalid Git revision: empty revision");
  try {
    await runGit(repo, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${revision}^{commit}`,
    ]);
  } catch (error) {
    throw new GitContextError(`invalid Git revision: ${revision}`, { cause: error });
  }
}

export async function resolveRevision(
  repo: string,
  revision: string,
): Promise<string> {
  await verifyRepository(repo);
  await verifyRevision(repo, revision);
  return (
    await runGit(repo, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${revision}^{commit}`,
    ])
  ).trim();
}

export async function readCommitTimestamp(repo: string, revision: string): Promise<string> {
  await verifyRepository(repo);
  await verifyRevision(repo, revision);
  const value = (await runGit(repo, [
    "show",
    "--no-patch",
    "--format=%cI",
    "--end-of-options",
    revision,
  ])).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(value)) {
    throw new GitContextError(`Git returned an invalid commit timestamp: ${revision}`);
  }
  return value;
}

export async function readDiff(
  repo: string,
  base: string,
  head: string,
): Promise<string> {
  await verifyRepository(repo);
  await verifyRevision(repo, base);
  await verifyRevision(repo, head);
  const diff = await runGit(repo, [
    "diff",
    "--unified=10000",
    base,
    head,
    "--",
    "*.yml",
    "*.yaml",
    "*.sql",
  ]);
  if (!diff.trim()) throw new GitContextError("no dbt schema or SQL changes found");
  return diff;
}
