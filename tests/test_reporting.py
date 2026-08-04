import json
from dataclasses import replace

from cutset.domain import (
    AssetRef,
    ColumnRename,
    ImpactDecision,
    ImpactEvidence,
    LineagePath,
    ReasonCode,
    RankedImpact,
    Severity,
)
from cutset.policy import analysis_key
from cutset.remediation import GeneratedRemediation, RemediationDraft, ValidationResult
from cutset.reporting import ImpactReport, render_json, render_markdown


def _critical_report() -> ImpactReport:
    source = AssetRef("urn:li:dataset:customers", "dataset", "customers")
    downstream = AssetRef("urn:li:mlModel:churn", "mlModel", "churn")
    return ImpactReport(
        analysis_key=analysis_key("owner/repo", "abc", "def"),
        repository="owner/repo",
        base="abc",
        head="def",
        change=ColumnRename("customers", "email", "email_address", "models/customers.yml"),
        evidence=ImpactEvidence(
            source=source,
            lineage_paths=(LineagePath(source, downstream, "email"),),
            complete=True,
        ),
        decision=ImpactDecision(
            Severity.CRITICAL, True, ReasonCode.ML_ASSETS_AFFECTED
        ),
    )


def test_markdown_contains_evidence_and_machine_reason_codes() -> None:
    markdown = render_markdown(_critical_report())

    assert "## Verdict: BLOCK" in markdown
    assert "ml_assets_affected" in markdown
    assert "urn:li:mlModel:" in markdown
    assert "CUTSET ANALYSIS KEY" in markdown


def test_json_is_canonical_and_uses_stable_enum_values() -> None:
    rendered = render_json(_critical_report())

    assert rendered == render_json(_critical_report())
    payload = json.loads(rendered)
    assert payload["decision"]["severity"] == "critical"
    assert payload["decision"]["reason"] == "ml_assets_affected"


def test_reports_ranked_impact_scores_and_factors() -> None:
    report = _critical_report()
    downstream = report.evidence.lineage_paths[0].downstream
    report = replace(
        report,
        ranked_impacts=(
            RankedImpact(downstream, 145, ("ml_asset", "column_mapping", "missing_owner")),
        ),
    )

    markdown = render_markdown(report)
    payload = json.loads(render_json(report))

    assert "## Ranked impact" in markdown
    assert "score `145`" in markdown
    assert "ml_asset, column_mapping, missing_owner" in markdown
    assert payload["ranked_impacts"] == [
        {
            "asset": {
                "asset_type": "mlModel",
                "name": "churn",
                "urn": "urn:li:mlModel:churn",
            },
            "factors": ["ml_asset", "column_mapping", "missing_owner"],
            "score": 145,
        }
    ]


def test_reports_remediation_grounding_and_query_citation() -> None:
    report = replace(
        _critical_report(),
        remediation=GeneratedRemediation(
            RemediationDraft(
                "select email as email_address from analytics.customers",
                "version: 2\nmodels: []\n",
                "observed usage",
                grounding_mode="query_grounded",
                supporting_query_urn="urn:li:query:q1",
            ),
            ValidationResult(True, ()),
        ),
    )

    markdown = render_markdown(report)
    payload = json.loads(render_json(report))

    assert "Grounding: `query_grounded`" in markdown
    assert "Supporting query: `urn:li:query:q1`" in markdown
    assert payload["remediation"]["grounding_mode"] == "query_grounded"
    assert payload["remediation"]["supporting_query_urn"] == "urn:li:query:q1"
