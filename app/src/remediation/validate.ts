import NodeSqlParser from "node-sql-parser";
import { parse as parseYaml } from "yaml";

import type { ChangeCase } from "../domain/case";
import {
  generateCompatibilityMigration,
  type RemediationArtifact,
} from "./generate";

const { Parser } = NodeSqlParser;

export interface RemediationValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export function validateRemediation(
  value: ChangeCase,
  artifacts: readonly RemediationArtifact[],
): RemediationValidation {
  const errors: string[] = [];
  let expected: readonly RemediationArtifact[];
  try {
    expected = generateCompatibilityMigration(value);
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : "could not generate grounded remediation"] };
  }
  const actualByPath = new Map<string, string>();
  for (const artifact of artifacts) {
    if (actualByPath.has(artifact.relativePath)) errors.push(`duplicate artifact path: ${artifact.relativePath}`);
    actualByPath.set(artifact.relativePath, artifact.content);
  }
  for (const artifact of expected) {
    const actual = actualByPath.get(artifact.relativePath);
    if (actual === undefined) errors.push(`required artifact is missing: ${artifact.relativePath}`);
    else if (actual !== artifact.content) errors.push(`artifact content does not match grounded deterministic output: ${artifact.relativePath}`);
  }
  for (const path of actualByPath.keys()) {
    if (!expected.some((artifact) => artifact.relativePath === path)) errors.push(`unrecognized remediation artifact: ${path}`);
  }
  if (errors.length === 0) {
    try {
      const sql = expected.find((artifact) => artifact.relativePath.endsWith(".sql"));
      const yaml = expected.find((artifact) => artifact.relativePath.endsWith(".yml"));
      if (sql === undefined || yaml === undefined) throw new Error("required artifact types are missing");
      new Parser().astify(sql.content.replace(/\{\{\s*ref\('[^']+'\)\s*\}\}/g, "changemarshal_source"), { database: "Snowflake" });
      const parsedYaml = parseYaml(yaml.content) as unknown;
      if (typeof parsedYaml !== "object" || parsedYaml === null) throw new Error("dbt YAML is not an object");
    } catch {
      errors.push("generated remediation is not valid supported SQL and dbt YAML");
    }
  }
  return { valid: errors.length === 0, errors };
}
