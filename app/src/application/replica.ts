import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
