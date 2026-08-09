import { describe, expect, it } from "vitest";

import { ApprovalRole, WorkKind } from "../../src/domain/case";
import { caseKey, revisionKey, workKey } from "../../src/domain/identity";

const sourceUrn =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)";
const change = {
  kind: "dbt_column_rename" as const,
  modelName: "customers",
  oldName: "email",
  newName: "email_address",
  sourcePath: "models/customers.yml",
};

describe("case identities", () => {
  it("keeps a logical case stable and makes different changes distinct", () => {
    const first = caseKey("owner/repo", sourceUrn, change);

    expect(first).toBe(caseKey("owner/repo", sourceUrn, change));
    expect(first).toHaveLength(24);
    expect(first).not.toBe(
      caseKey("owner/repo", sourceUrn, { ...change, newName: "primary_email" }),
    );
  });

  it("invalidates a revision when the head or evidence changes", () => {
    const logical = caseKey("owner/repo", sourceUrn, change);
    const baseline = revisionKey(logical, "base", "head-a", "evidence-a");

    expect(baseline).not.toBe(
      revisionKey(logical, "base", "head-b", "evidence-a"),
    );
    expect(baseline).not.toBe(
      revisionKey(logical, "base", "head-a", "evidence-b"),
    );
  });

  it("makes work identity independent of affected-asset ordering", () => {
    const logical = caseKey("owner/repo", sourceUrn, change);
    const owner = "urn:li:corpuser:consumer";

    expect(
      workKey(logical, owner, WorkKind.ConsumerAcknowledgement, [
        "urn:li:dataset:b",
        "urn:li:dataset:a",
      ]),
    ).toBe(
      workKey(logical, owner, WorkKind.ConsumerAcknowledgement, [
        "urn:li:dataset:a",
        "urn:li:dataset:b",
      ]),
    );
  });

  it("rejects missing and ungoverned identity inputs", () => {
    expect(() => caseKey("", sourceUrn, change)).toThrow(/repository/i);
    expect(() => caseKey("owner/repo", "customers", change)).toThrow(
      /DataHub URN/i,
    );
    expect(() =>
      workKey(
        "case",
        "urn:li:corpuser:owner",
        WorkKind.ProducerMigration,
        [],
      ),
    ).toThrow(/affected/i);
  });

  it("has stable role and work wire values", () => {
    expect(ApprovalRole.Producer).toBe("producer");
    expect(ApprovalRole.Consumer).toBe("consumer");
    expect(WorkKind.MlValidation).toBe("ml_validation");
  });
});
