import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { runValidation, ValidationRunnerError } from "../../src/validation/runner";

const execFile = promisify(execFileCallback);

async function repository(): Promise<Readonly<{ root: string; head: string }>> {
  const root = await mkdtemp(join(tmpdir(), "changemarshal-validation-"));
  await execFile("git", ["init", "-q", root]);
  await execFile("git", ["-C", root, "config", "user.email", "changemarshal@example.com"]);
  await execFile("git", ["-C", root, "config", "user.name", "ChangeMarshal Tests"]);
  await writeFile(join(root, "tracked.txt"), "tracked\n", "utf8");
  await execFile("git", ["-C", root, "add", "tracked.txt"]);
  await execFile("git", ["-C", root, "commit", "-qm", "base"]);
  const { stdout } = await execFile("git", ["-C", root, "rev-parse", "HEAD"]);
  return { root, head: stdout.trim() };
}

describe("executable validation receipts", () => {
  it("runs a real command and hashes bounded output and artifacts", async () => {
    const repo = await repository();
    await mkdir(join(repo.root, ".changemarshal"));
    await writeFile(join(repo.root, ".changemarshal", "artifact.sql"), "select 1;\n", "utf8");

    const receipt = await runValidation({
      repoRoot: repo.root,
      workKey: "a".repeat(24), revisionKey: "b".repeat(24), headSha: repo.head,
      command: [process.execPath, "-e", "process.stdout.write('validated')"],
      artifactPaths: [".changemarshal/artifact.sql"],
      timeoutMs: 5_000,
      now: (() => {
        const values = [new Date("2026-08-09T10:00:00.000Z"), new Date("2026-08-09T10:00:01.000Z")];
        return () => values.shift() as Date;
      })(),
    });

    expect(receipt.valid).toBe(true);
    expect(receipt.exitCode).toBe(0);
    expect(receipt.stdoutSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.artifactHashes).toEqual([[".changemarshal/artifact.sql", expect.stringMatching(/^[a-f0-9]{64}$/)]]);
  });

  it("records nonzero and timeout results as invalid", async () => {
    const repo = await repository();
    const failed = await runValidation({
      repoRoot: repo.root, workKey: "a".repeat(24), revisionKey: "b".repeat(24), headSha: repo.head,
      command: [process.execPath, "-e", "process.stderr.write('no'); process.exit(3)"], artifactPaths: [], timeoutMs: 5_000,
    });
    expect(failed).toMatchObject({ valid: false, exitCode: 3 });

    const timedOut = await runValidation({
      repoRoot: repo.root, workKey: "a".repeat(24), revisionKey: "b".repeat(24), headSha: repo.head,
      command: [process.execPath, "-e", "setTimeout(() => {}, 10000)"], artifactPaths: [], timeoutMs: 20,
    });
    expect(timedOut.valid).toBe(false);
    expect(timedOut.exitCode).toBe(-1);
  });

  it("rejects stale Git heads and artifacts outside or escaping the repository", async () => {
    const repo = await repository();
    const base = {
      repoRoot: repo.root, workKey: "a".repeat(24), revisionKey: "b".repeat(24),
      command: [process.execPath, "-e", "process.exit(0)"], timeoutMs: 5_000,
    };
    await expect(runValidation({ ...base, headSha: "0".repeat(40), artifactPaths: [] }))
      .rejects.toThrow(/head/i);
    await expect(runValidation({ ...base, headSha: repo.head, artifactPaths: ["../outside"] }))
      .rejects.toBeInstanceOf(ValidationRunnerError);
  });
});
