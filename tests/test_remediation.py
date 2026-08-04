import json

from cutset.domain import (
    AssetContext,
    AssetRef,
    ColumnRename,
    ImpactDecision,
    ImpactEvidence,
    ReasonCode,
    Severity,
    UsageQuery,
)
from cutset.remediation import (
    RemediationDraft,
    generate_remediation,
    parse_remediation_response,
    select_remediation_grounding,
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
    source = AssetRef(
        "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)",
        "dataset",
        "customers",
    )
    return ImpactEvidence(
        source=source,
        lineage_paths=(),
        complete=True,
        change=ColumnRename(
            "customers", "email", "email_address", "models/customers.yml"
        ),
        schema_fields=("customer_id", "email"),
        asset_contexts=(AssetContext(asset=source),),
    )


def test_accepts_alias_from_verified_old_to_new_column() -> None:
    draft = RemediationDraft(
        "select email as email_address from analytics.customers",
        VALID_SCHEMA_YAML,
        "compatibility alias",
    )

    assert validate_remediation(draft, _rename_evidence()).valid is True


def test_rejects_unseen_source_column() -> None:
    draft = RemediationDraft(
        "select invented as email_address from analytics.customers",
        VALID_SCHEMA_YAML,
        "",
    )

    result = validate_remediation(draft, _rename_evidence())

    assert result.valid is False
    assert "invented" in result.errors[0]


def test_rejects_empty_dbt_tests() -> None:
    schema = VALID_SCHEMA_YAML.replace("          - not_null\n", "")
    draft = RemediationDraft(
        "select email as email_address from analytics.customers",
        schema,
        "compatibility alias",
    )

    result = validate_remediation(draft, _rename_evidence())

    assert result.valid is False
    assert any("test" in error for error in result.errors)


def test_parses_only_an_exact_structured_response() -> None:
    response = json.dumps(
        {
            "sql": "select email as email_address from analytics.customers",
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
                "sql": "select invented as email_address from analytics.customers",
                "schema_yaml": VALID_SCHEMA_YAML,
                "explanation": "bad source",
            }
        ),
    )

    assert result.validation.valid is False
    assert "invented" in result.validation.errors[0]


def _evidence_with_query(statement: str, source: str = "SYSTEM") -> ImpactEvidence:
    evidence = _rename_evidence()
    query = UsageQuery(
        "urn:li:query:q1",
        source,
        "SQL",
        "customer usage",
        statement,
        (evidence.source.urn,),
    )
    return ImpactEvidence(
        source=evidence.source,
        lineage_paths=evidence.lineage_paths,
        complete=True,
        change=evidence.change,
        schema_fields=evidence.schema_fields,
        asset_contexts=(
            AssetContext(asset=evidence.source, query_total=1, queries=(query,)),
        ),
    )


def test_prefers_observed_query_relation_and_cites_query() -> None:
    grounding = select_remediation_grounding(
        _evidence_with_query(
            "SELECT email FROM analytics.customers WHERE region = ?"
        )
    )

    assert grounding.mode == "query_grounded"
    assert grounding.relation == "analytics.customers"
    assert grounding.query_urn == "urn:li:query:q1"


def test_ambiguous_query_falls_back_to_verified_dataset_name() -> None:
    grounding = select_remediation_grounding(
        _evidence_with_query(
            "SELECT a.email FROM analytics.customers AS a "
            "JOIN crm.contacts AS c ON a.email = c.email"
        )
    )

    assert grounding.mode == "schema_grounded"
    assert grounding.relation == "analytics.customers"
    assert grounding.query_urn is None


def test_query_grounded_draft_must_match_cited_observed_relation() -> None:
    evidence = _evidence_with_query(
        "SELECT email FROM analytics.customers WHERE region = ?"
    )
    draft = RemediationDraft(
        "select email as email_address from crm.contacts",
        VALID_SCHEMA_YAML,
        "wrong relation",
        grounding_mode="query_grounded",
        supporting_query_urn="urn:li:query:q1",
    )

    result = validate_remediation(draft, evidence)

    assert result.valid is False
    assert any("observed query relation" in error for error in result.errors)


def test_query_grounded_draft_rejects_unknown_supporting_query() -> None:
    evidence = _evidence_with_query("SELECT email FROM analytics.customers")
    draft = RemediationDraft(
        "select email as email_address from analytics.customers",
        VALID_SCHEMA_YAML,
        "unknown citation",
        grounding_mode="query_grounded",
        supporting_query_urn="urn:li:query:missing",
    )

    result = validate_remediation(draft, evidence)

    assert result.valid is False
    assert any("supporting query" in error for error in result.errors)
