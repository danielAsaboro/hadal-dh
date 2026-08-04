import json

from cutset.domain import (
    AssetRef,
    ColumnRename,
    ImpactDecision,
    ImpactEvidence,
    ReasonCode,
    Severity,
)
from cutset.remediation import (
    RemediationDraft,
    generate_remediation,
    parse_remediation_response,
    validate_remediation,
)


VALID_SCHEMA_YAML = """\
version: 2
models:
  - name: customers
    columns:
      - name: email_address
        tests:
          - not_null
"""


def _rename_evidence() -> ImpactEvidence:
    return ImpactEvidence(
        source=AssetRef("urn:li:dataset:customers", "dataset", "customers"),
        lineage_paths=(),
        complete=True,
        change=ColumnRename(
            "customers", "email", "email_address", "models/customers.yml"
        ),
        schema_fields=("customer_id", "email"),
    )


def test_accepts_alias_from_verified_old_to_new_column() -> None:
    draft = RemediationDraft(
        "select email as email_address from upstream",
        VALID_SCHEMA_YAML,
        "compatibility alias",
    )

    assert validate_remediation(draft, _rename_evidence()).valid is True


def test_rejects_unseen_source_column() -> None:
    draft = RemediationDraft(
        "select invented as email_address from upstream", VALID_SCHEMA_YAML, ""
    )

    result = validate_remediation(draft, _rename_evidence())

    assert result.valid is False
    assert "invented" in result.errors[0]


def test_rejects_empty_dbt_tests() -> None:
    schema = VALID_SCHEMA_YAML.replace("          - not_null\n", "")
    draft = RemediationDraft(
        "select email as email_address from upstream", schema, "compatibility alias"
    )

    result = validate_remediation(draft, _rename_evidence())

    assert result.valid is False
    assert any("test" in error for error in result.errors)


def test_parses_only_an_exact_structured_response() -> None:
    response = json.dumps(
        {
            "sql": "select email as email_address from upstream",
            "schema_yaml": VALID_SCHEMA_YAML,
            "explanation": "compatibility alias",
        }
    )

    assert parse_remediation_response(response).explanation == "compatibility alias"

    wrapped = f"Here is the patch:\n{response}"
    try:
        parse_remediation_response(wrapped)
    except ValueError as error:
        assert "JSON object" in str(error)
    else:
        raise AssertionError("prose-wrapped JSON must be rejected")


def test_generation_validates_model_output() -> None:
    decision = ImpactDecision(
        Severity.HIGH, True, ReasonCode.DOWNSTREAM_COLUMN_CONSUMERS
    )

    result = generate_remediation(
        _rename_evidence(),
        decision,
        lambda _: json.dumps(
            {
                "sql": "select invented as email_address from upstream",
                "schema_yaml": VALID_SCHEMA_YAML,
                "explanation": "bad source",
            }
        ),
    )

    assert result.validation.valid is False
    assert "invented" in result.validation.errors[0]
