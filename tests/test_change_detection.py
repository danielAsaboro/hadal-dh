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
