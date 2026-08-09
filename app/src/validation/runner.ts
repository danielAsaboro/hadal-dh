import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { ValidationReceiptSchema, type ValidationReceipt } from "../domain/case";
import { resolveRevision } from "../git/repository";

export class ValidationRunnerError extends Error {
  override readonly name = "ValidationRunnerError";
}

export interface ValidationRunInput {
  readonly repoRoot: string;
  readonly workKey: string;
  readonly revisionKey: string;
  readonly headSha: string;
  readonly command: readonly string[];
  readonly artifactPaths: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;
  readonly now?: () => Date;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function hashArtifacts(root: string, paths: readonly string[]): Promise<readonly [string, string][]> {
  const result: Array<[string, string]> = [];
  for (const path of [...new Set(paths)].sort()) {
    if (!path || path.includes("\0") || isAbsolute(path)) {
      throw new ValidationRunnerError(`artifact path must be repository-relative: ${path}`);
    }
    const candidate = resolve(root, path);
    const lexical = relative(root, candidate);
    if (lexical === ".." || lexical.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new ValidationRunnerError(`artifact escapes repository: ${path}`);
    }
    const stat = await lstat(candidate).catch((error: unknown) => {
      throw new ValidationRunnerError(`artifact does not exist: ${path}`, { cause: error });
    });
    if (!stat.isFile() || stat.isSymbolicLink()) throw new ValidationRunnerError(`artifact must be a regular file: ${path}`);
    const actual = await realpath(candidate);
    const escaped = relative(root, actual);
    if (escaped === ".." || escaped.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new ValidationRunnerError(`artifact resolves outside repository: ${path}`);
    }
    result.push([path, sha256(await readFile(actual))]);
  }
  return result;
}

async function execute(
  command: readonly string[],
  cwd: string,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<Readonly<{ exitCode: number; stdout: Buffer; stderr: Buffer }>> {
  return await new Promise((resolvePromise) => {
    const child = spawn(command[0] as string, command.slice(1), {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let invalid = false;
    let timedOut = false;
    const collect = (target: Buffer[], chunk: Buffer, current: number): number => {
      const remaining = maxOutputBytes - current;
      if (remaining > 0) target.push(chunk.subarray(0, remaining));
      if (chunk.length > remaining) {
        invalid = true;
        child.kill("SIGTERM");
      }
      return current + chunk.length;
    };
    child.stdout.on("data", (chunk: Buffer) => { stdoutBytes = collect(stdout, chunk, stdoutBytes); });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes = collect(stderr, chunk, stderrBytes); });
    child.on("error", () => { invalid = true; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 250).unref();
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: timedOut || invalid ? -1 : (code ?? -1),
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
  });
}

export async function runValidation(input: ValidationRunInput): Promise<ValidationReceipt> {
  if (input.command.length === 0 || input.command.some((part) => !part)) {
    throw new ValidationRunnerError("validation command must contain non-empty arguments");
  }
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 300_000) {
    throw new ValidationRunnerError("validation timeout must be between 1 and 300000 milliseconds");
  }
  const root = await realpath(input.repoRoot).catch((error: unknown) => {
    throw new ValidationRunnerError("validation repository does not exist", { cause: error });
  });
  const actualHead = await resolveRevision(root, "HEAD");
  if (actualHead !== input.headSha) throw new ValidationRunnerError("validation repository head does not match the case head");
  const clock = input.now ?? (() => new Date());
  const startedAt = clock().toISOString();
  const result = await execute(input.command, root, input.timeoutMs, input.maxOutputBytes ?? 1_000_000);
  const artifactHashes = await hashArtifacts(root, input.artifactPaths);
  const finishedAt = clock().toISOString();
  return ValidationReceiptSchema.parse({
    receiptKey: input.workKey,
    workKey: input.workKey,
    revisionKey: input.revisionKey,
    headSha: input.headSha,
    command: input.command,
    exitCode: result.exitCode,
    stdoutSha256: sha256(result.stdout),
    stderrSha256: sha256(result.stderr),
    artifactHashes,
    startedAt,
    finishedAt,
    valid: result.exitCode === 0,
  });
}
