import {
  DbtColumnRenameSchema,
  type DbtColumnRename,
} from "../domain/case";

export class UnsupportedChangeError extends Error {
  override readonly name = "UnsupportedChangeError";
}

const newPath = /^\+\+\+ b\/(.+\.ya?ml)$/gm;
const yamlName = /^(?<indent>[ \t]*)-\s+name:\s+(?<name>[^\s#]+)/;

export function detectColumnRename(diff: string): DbtColumnRename {
  const paths = [...diff.matchAll(newPath)].map((match) => match[1]);
  if (paths.length !== 1 || !paths[0]) {
    throw new UnsupportedChangeError("expected exactly one changed dbt YAML file");
  }
  const removed: Array<readonly [string, string | null]> = [];
  const added: Array<readonly [string, string | null]> = [];
  let currentModel: string | null = null;
  let inColumns = false;

  for (const line of diff.split(/\r?\n/)) {
    if (
      !line ||
      line.startsWith("+++") ||
      line.startsWith("---") ||
      ![" ", "+", "-"].includes(line[0] ?? "")
    ) {
      continue;
    }
    const prefix = line[0];
    const content = line.slice(1);
    const match = yamlName.exec(content);
    const indentation = content.length - content.trimStart().length;

    if (prefix === " ") {
      if (match?.groups && indentation === 2) {
        currentModel = match.groups.name ?? null;
        inColumns = false;
      } else if (
        currentModel !== null &&
        indentation === 4 &&
        content.trim() === "columns:"
      ) {
        inColumns = true;
      } else if (content.trim() && indentation <= 2 && !match) {
        currentModel = null;
        inColumns = false;
      }
      continue;
    }

    if (match?.groups && indentation >= 4) {
      const target = prefix === "-" ? removed : added;
      target.push([match.groups.name ?? "", inColumns ? currentModel : null]);
    }
  }

  if (removed.length !== 1 || added.length !== 1) {
    throw new UnsupportedChangeError(
      "expected exactly one removed and one added dbt column",
    );
  }
  const [oldName, removedModel] = removed[0] ?? ["", null];
  const [newName, addedModel] = added[0] ?? ["", null];
  if (!removedModel || removedModel !== addedModel) {
    throw new UnsupportedChangeError(
      "could not identify exactly one containing dbt model for the column rename",
    );
  }

  return DbtColumnRenameSchema.parse({
    kind: "dbt_column_rename",
    modelName: removedModel,
    oldName,
    newName,
    sourcePath: paths[0],
  });
}
