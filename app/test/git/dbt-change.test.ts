import { describe, expect, it } from "vitest";

import { detectColumnRename } from "../../src/git/dbt-change";

const renameDiff = `diff --git a/models/customers.yml b/models/customers.yml
index 375c32a..cd75dd2 100644
--- a/models/customers.yml
+++ b/models/customers.yml
@@ -1,5 +1,5 @@
 models:
   - name: customers
     columns:
-      - name: email
+      - name: email_address
       - name: customer_id
`;

describe("dbt change detection", () => {
  it("detects one unambiguous column rename", () => {
    expect(detectColumnRename(renameDiff)).toEqual({
      kind: "dbt_column_rename",
      modelName: "customers",
      oldName: "email",
      newName: "email_address",
      sourcePath: "models/customers.yml",
    });
  });

  it("rejects several removed columns instead of guessing", () => {
    const ambiguous = renameDiff.replace(
      "-      - name: email",
      "-      - name: email\n-      - name: phone",
    );

    expect(() => detectColumnRename(ambiguous)).toThrow(
      /exactly one removed and one added/i,
    );
  });

  it("rejects a rename without a containing dbt model", () => {
    const unscoped = renameDiff.replace("   - name: customers\n", "");

    expect(() => detectColumnRename(unscoped)).toThrow(/containing dbt model/i);
  });

  it("rejects more than one changed schema file", () => {
    const secondHeader = renameDiff.replaceAll("customers", "orders");

    expect(() => detectColumnRename(`${renameDiff}\n${secondHeader}`)).toThrow(
      /exactly one changed dbt YAML file/i,
    );
  });
});
