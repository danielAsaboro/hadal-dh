from pathlib import Path

import pytest

from cutset.change_detection import UnsupportedChangeError, parse_column_rename


def test_parses_one_dbt_column_rename() -> None:
    diff = Path("tests/fixtures/rename_customer_email.diff").read_text()

    rename = parse_column_rename(diff)

    assert rename.old_name == "email"
    assert rename.new_name == "email_address"
    assert rename.model_name == "customers"
    assert rename.source_path == "models/customers.yml"


def test_rejects_multiple_column_changes() -> None:
    diff = """\
-      - name: email
+      - name: email_address
-      - name: id
+      - name: customer_id
"""

    with pytest.raises(UnsupportedChangeError, match="exactly one"):
        parse_column_rename(diff)


def test_rejects_a_model_rename_as_a_column_change() -> None:
    diff = """\
diff --git a/models/schema.yml b/models/schema.yml
--- a/models/schema.yml
+++ b/models/schema.yml
@@ -2 +2 @@ models:
-  - name: customers
+  - name: clients
"""

    with pytest.raises(UnsupportedChangeError, match="column"):
        parse_column_rename(diff)


def test_uses_containing_model_instead_of_yaml_filename() -> None:
    diff = """\
diff --git a/models/schema.yml b/models/schema.yml
--- a/models/schema.yml
+++ b/models/schema.yml
@@ -1,5 +1,5 @@
 models:
   - name: customers
     columns:
-      - name: email
+      - name: email_address
"""

    assert parse_column_rename(diff).model_name == "customers"


def test_rejects_a_source_column_rename() -> None:
    diff = """\
diff --git a/models/sources.yml b/models/sources.yml
--- a/models/sources.yml
+++ b/models/sources.yml
@@ -1,7 +1,7 @@
 sources:
   - name: raw
     tables:
       - name: customers
         columns:
-          - name: email
+          - name: email_address
"""

    with pytest.raises(UnsupportedChangeError, match="dbt model"):
        parse_column_rename(diff)
