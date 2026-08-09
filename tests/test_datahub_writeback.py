import pytest

from cutset.datahub_gateway import DataHubGateway, DataHubWriteBackError
from cutset.domain import (
    AssetRef,
    ColumnRename,
    ImpactDecision,
    ImpactEvidence,
    LineagePath,
    ReasonCode,
    Severity,
)
from cutset.reporting import ImpactReport
from cutset.remediation import GeneratedRemediation, RemediationDraft, ValidationResult


class _Tool:
    def __init__(self, name: str, response: object) -> None:
        self.name = name
        self.response = response
        self.calls: list[dict] = []

    def invoke(self, arguments: dict) -> object:
        self.calls.append(arguments)
        return self.response


def _report() -> ImpactReport:
    source = AssetRef("urn:li:dataset:customers", "dataset", "customers")
    model = AssetRef("urn:li:mlModel:churn", "mlModel", "churn")
    return ImpactReport(
        analysis_key="abc123",
        repository="owner/repo",
        base="base",
        head="head",
        change=ColumnRename("customers", "email", "email_address", "customers.yml"),
        evidence=ImpactEvidence(
            source=source,
            lineage_paths=(LineagePath(source, model, "email"),),
            complete=True,
        ),
        decision=ImpactDecision(
            Severity.CRITICAL, True, ReasonCode.ML_ASSETS_AFFECTED
        ),
    )


def _safe_report() -> ImpactReport:
    report = _report()
    return ImpactReport(
        analysis_key=report.analysis_key,
        repository=report.repository,
        base=report.base,
        head=report.head,
        change=report.change,
        evidence=ImpactEvidence(
            source=report.evidence.source,
            lineage_paths=(),
            complete=True,
        ),
        decision=ImpactDecision(
            Severity.INFO, False, ReasonCode.NO_DOWNSTREAM_CONSUMERS
        ),
    )


def _gateway(tag_success: bool = True) -> DataHubGateway:
    return DataHubGateway(
        client=object(),
        tools=[
            _Tool(
                "search",
                {
                    "searchResults": [
                        {
                            "entity": {
                                "urn": "urn:li:tag:changemarshal-at-risk",
                                "type": "TAG",
                                "name": "changemarshal-at-risk",
                                "properties": {"name": "ChangeMarshal: At Risk"},
                            }
                        },
                        {
                            "entity": {
                                "urn": "urn:li:tag:cutset-at-risk",
                                "type": "TAG",
                                "name": "cutset-at-risk",
                                "properties": {"name": "Cutset: At Risk"},
                            }
                        }
                    ],
                    "total": 2,
                },
            ),
            _Tool("search_documents", {"searchResults": [], "total": 0}),
            _Tool(
                "save_document",
                {
                    "success": True,
                    "urn": "urn:li:document:cutset-impact-abc123",
                    "message": "saved",
                },
            ),
            _Tool("add_tags", {"success": tag_success, "message": "tagged"}),
        ],
    )


def test_write_back_uses_only_current_evidence_urns() -> None:
    gateway = _gateway()

    result = gateway.write_back(_report(), tag_name="cutset-at-risk")

    assert result.success is True
    assert result.document_urn == "urn:li:document:cutset-impact-abc123"
    assert gateway.tools["add_tags"].calls[0]["entity_urns"] == [
        "urn:li:dataset:customers",
        "urn:li:mlModel:churn",
    ]
    assert gateway.tools["save_document"].calls[0]["related_assets"] == [
        "urn:li:dataset:customers",
        "urn:li:mlModel:churn",
    ]


def test_partial_write_back_is_a_failure() -> None:
    gateway = _gateway(tag_success=False)

    with pytest.raises(DataHubWriteBackError, match="add_tags") as captured:
        gateway.write_back(_report(), tag_name="cutset-at-risk")

    assert captured.value.document_saved is True
    assert captured.value.tags_applied is False


def test_non_blocking_report_is_documented_without_risk_tag() -> None:
    gateway = _gateway()

    result = gateway.write_back(_safe_report(), tag_name="cutset-at-risk")

    assert result.success is True
    assert result.tagged_urns == ()
    assert gateway.tools["add_tags"].calls == []


def test_does_not_update_a_fuzzy_document_search_match() -> None:
    gateway = _gateway()
    gateway.tools["search_documents"].response = {
        "searchResults": [
            {
                "entity": {
                    "urn": "urn:li:document:unrelated",
                    "info": {"title": "A different impact analysis"},
                }
            }
        ],
        "total": 1,
    }

    gateway.write_back(_report())

    assert "urn" not in gateway.tools["save_document"].calls[0]


def test_updates_only_the_exact_analysis_document() -> None:
    gateway = _gateway()
    gateway.tools["search_documents"].response = {
        "searchResults": [
            {
                "entity": {
                    "urn": "urn:li:document:existing",
                    "info": {"title": "Cutset impact abc123"},
                }
            }
        ],
        "total": 1,
    }

    result = gateway.write_back(_report())

    assert result.updated_existing_document is True
    assert gateway.tools["save_document"].calls[0]["urn"] == "urn:li:document:existing"


def test_gateway_rejects_incomplete_evidence_before_any_mutation() -> None:
    gateway = _gateway()
    report = _report()
    incomplete = ImpactReport(
        analysis_key=report.analysis_key,
        repository=report.repository,
        base=report.base,
        head=report.head,
        change=report.change,
        evidence=ImpactEvidence(
            source=report.evidence.source,
            lineage_paths=report.evidence.lineage_paths,
            complete=False,
        ),
        decision=ImpactDecision(
            Severity.BLOCKED, True, ReasonCode.CONTEXT_INCOMPLETE
        ),
    )

    with pytest.raises(DataHubWriteBackError, match="complete evidence"):
        gateway.write_back(incomplete)

    assert gateway.tools["save_document"].calls == []
    assert gateway.tools["add_tags"].calls == []


def test_gateway_rejects_invalid_remediation_before_any_mutation() -> None:
    gateway = _gateway()
    report = _report()
    invalid = ImpactReport(
        analysis_key=report.analysis_key,
        repository=report.repository,
        base=report.base,
        head=report.head,
        change=report.change,
        evidence=report.evidence,
        decision=report.decision,
        remediation=GeneratedRemediation(
            RemediationDraft("bad", "bad", "bad"),
            ValidationResult(False, ("invalid",)),
        ),
    )

    with pytest.raises(DataHubWriteBackError, match="valid remediation"):
        gateway.write_back(invalid)

    assert gateway.tools["save_document"].calls == []


def test_missing_risk_tag_is_detected_before_document_save() -> None:
    gateway = _gateway()
    gateway.tools["search"].response = {"searchResults": [], "total": 0}

    with pytest.raises(DataHubWriteBackError, match="existing DataHub tag"):
        gateway.write_back(_report())

    assert gateway.tools["save_document"].calls == []


def test_malformed_tag_urn_is_a_controlled_preflight_failure() -> None:
    gateway = _gateway()
    gateway.tools["search"].response["searchResults"][0]["entity"]["urn"] = (
        "urn:li:tag:(malformed"
    )

    with pytest.raises(DataHubWriteBackError, match="existing DataHub tag"):
        gateway.write_back(_report())

    assert gateway.tools["save_document"].calls == []
