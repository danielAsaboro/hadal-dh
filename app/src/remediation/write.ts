import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { RemediationArtifact } from "./generate";

export class RemediationWriteError extends Error {
  override readonly name = "RemediationWriteError";
}

export async function writeRemediationArtifacts(
  repoRoot: string,
  artifacts: readonly RemediationArtifact[],
): Promise<readonly string[]> {
  const root = await realpath(repoRoot);
  const written: string[] = [];
  for (const artifact of artifacts) {
    if (!artifact.relativePath || isAbsolute(artifact.relativePath) || artifact.relativePath.includes("\0")) {
      throw new RemediationWriteError(`invalid remediation path: ${artifact.relativePath}`);
    }
    const target = resolve(root, artifact.relativePath);
    const escaped = relative(root, target);
    if (escaped === ".." || escaped.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new RemediationWriteError(`remediation path escapes repository: ${artifact.relativePath}`);
    }
    const existing = await readFile(target, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    let legacyTarget: string | undefined;
    let legacyExisting: string | undefined;
    if (artifact.legacy !== undefined) {
      legacyTarget = resolve(root, artifact.legacy.relativePath);
      const legacyEscaped = relative(root, legacyTarget);
      if (isAbsolute(artifact.legacy.relativePath)
        || legacyEscaped === ".."
        || legacyEscaped.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
        throw new RemediationWriteError(`legacy remediation path escapes repository: ${artifact.legacy.relativePath}`);
      }
      legacyExisting = await readFile(legacyTarget, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (legacyExisting !== undefined && legacyExisting !== artifact.legacy.content) {
        throw new RemediationWriteError(`conflicting legacy remediation artifact: ${artifact.legacy.relativePath}`);
      }
    }
    if (existing !== undefined && existing !== artifact.content) {
      throw new RemediationWriteError(`refusing to overwrite changed remediation artifact: ${artifact.relativePath}`);
    }
    if (existing !== artifact.content) {
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, artifact.content, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await rename(temporary, target);
        if (await readFile(target, "utf8") !== artifact.content) {
          throw new RemediationWriteError(`remediation artifact reread failed: ${artifact.relativePath}`);
        }
        written.push(artifact.relativePath);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    }
    if (legacyExisting !== undefined && legacyTarget !== undefined) await unlink(legacyTarget);
  }
  return written;
}
