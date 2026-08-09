import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, sep } from "node:path";

import type { ChangeCase } from "../domain/case";
import { serializeCase } from "../domain/serialization";

export interface CaseReplica {
  save(value: ChangeCase): Promise<void>;
}

export class AtomicCaseReplica implements CaseReplica {
  constructor(private readonly path: string) {
    if (!path) throw new Error("replica path must be non-empty");
  }

  async save(value: ChangeCase): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true });
    const legacyPath = this.path.includes(`${sep}.changemarshal${sep}`)
      ? this.path.replace(`${sep}.changemarshal${sep}`, `${sep}.cutset${sep}`)
      : undefined;
    if (legacyPath !== undefined) {
      const [canonical, legacy] = await Promise.all([
        readFile(this.path).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error)),
        readFile(legacyPath).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error)),
      ]);
      if (canonical !== undefined && legacy !== undefined && !canonical.equals(legacy)) {
        throw new Error("conflicting canonical and legacy case replica paths");
      }
      if (legacy !== undefined) {
        if (canonical === undefined) await rename(legacyPath, this.path);
        else await unlink(legacyPath);
      }
    }
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, serializeCase(value), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, this.path);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}
