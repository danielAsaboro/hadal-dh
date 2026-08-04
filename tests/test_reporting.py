import json

from cutset.domain import (
    AssetRef,
    ColumnRename,
    ImpactDecision,
    ImpactEvidence,
    LineagePath,
    ReasonCode,
    Severity,
)
from cutset.policy import analysis_key
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

