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
    if (existing !== undefined && existing !== artifact.content) {
      throw new RemediationWriteError(`refusing to overwrite changed remediation artifact: ${artifact.relativePath}`);
    }
    if (existing === artifact.content) continue;
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, artifact.content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, target);
      written.push(artifact.relativePath);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
  return written;
}
