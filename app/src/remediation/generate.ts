import type { ChangeCase } from "../domain/case";

export interface RemediationArtifact {
  readonly relativePath: string;
  readonly content: string;
  readonly legacy?: Readonly<{ relativePath: string; content: string }>;
}

export class RemediationGenerationError extends Error {
  override readonly name = "RemediationGenerationError";
}

function identifier(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new RemediationGenerationError(`${label} is not a safe dbt identifier`);
  }
  return value;
}

export function generateCompatibilityMigration(value: ChangeCase): readonly RemediationArtifact[] {
  if (!value.evidence.complete) throw new RemediationGenerationError("complete DataHub evidence is required");
  const model = identifier(value.change.modelName, "model name");
  const oldName = identifier(value.change.oldName, "old column");
  const newName = identifier(value.change.newName, "new column");
  if (!value.evidence.schemaFields.includes(oldName)) {
    throw new RemediationGenerationError(`old column ${oldName} is absent from the verified schema`);
  }
  if (oldName === newName || value.evidence.schemaFields.includes(newName)) {
    throw new RemediationGenerationError("new column conflicts with the verified source schema");
  }
  const sourceContext = value.evidence.assets.find((asset) => asset.urn === value.evidence.source.urn);
  if (sourceContext === undefined || !sourceContext.complete) {
    throw new RemediationGenerationError("verified source context is missing");
  }
  const hasNotNull = sourceContext.assertions.some((assertion) =>
    assertion.column === oldName && assertion.type.toUpperCase().includes("NOT_NULL"));
  const yamlTests = hasNotNull ? "\n        tests:\n          - not_null" : "";
  const sql = [
    `-- Hadal case ${value.caseKey}; revision ${value.revision.revisionKey}`,
    `-- Compatibility view for ${value.evidence.source.urn}`,
    "SELECT",
    "  source.* ,",
    `  source.\"${newName}\" AS \"${oldName}\"`,
    `FROM {{ ref('${model}') }} AS source`,
    "",
  ].join("\n");
  const yaml = [
    "version: 2",
    "models:",
    `  - name: ${model}_compatibility`,
    "    description: >-",
    `      Compatibility contract for Hadal case ${value.caseKey} at revision ${value.revision.revisionKey}.`,
    "    columns:",
    `      - name: ${oldName}${yamlTests}`,
    "        description: >-",
    `          Deprecated compatibility alias for ${newName}; remove only after governed consumer migration.`,
    "",
  ].join("\n");
  return [
    {
      relativePath: `.changemarshal/remediation/${model}_compatibility.sql`,
      content: sql,
      legacy: {
        relativePath: `.cutset/remediation/${model}_compatibility.sql`,
        content: sql.replace("Hadal case", "Cutset case"),
      },
    },
    {
      relativePath: `.changemarshal/remediation/${model}_compatibility.yml`,
      content: yaml,
      legacy: {
        relativePath: `.cutset/remediation/${model}_compatibility.yml`,
        content: yaml.replace("Hadal case", "Cutset case"),
      },
    },
  ];
}
