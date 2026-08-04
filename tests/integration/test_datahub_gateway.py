import os
import time

import pytest

from cutset.datahub_gateway import DataHubGateway
from cutset.domain import ColumnRename
from cutset.policy import analysis_key, decide
from cutset.reporting import ImpactReport


def _model_name(dataset_urn: str) -> str:
    try:
        dataset_name = dataset_urn.rsplit(",", 2)[-2]
    except IndexError as error:
        raise AssertionError("CUTSET_INTEGRATION_DATASET must be a dataset URN") from error
    return dataset_name.rsplit(".", 1)[-1]


@pytest.mark.integration
def test_collects_evidence_from_live_datahub() -> None:
    dataset_urn = os.getenv("CUTSET_INTEGRATION_DATASET")
    if not dataset_urn:
        pytest.skip("CUTSET_INTEGRATION_DATASET is not configured")
    old_column = os.getenv("CUTSET_INTEGRATION_COLUMN", "email")
    gateway = DataHubGateway.from_env()

    evidence = gateway.collect_evidence(
        ColumnRename(
            model_name=_model_name(dataset_urn),
            old_name=old_column,
            new_name=f"{old_column}_address",
            source_path="models/schema.yml",
        )
    )

    assert evidence.source.urn == dataset_urn
    assert evidence.complete is True
    assert all(path.nodes for path in evidence.lineage_paths)


@pytest.mark.integration
def test_live_write_back_is_idempotent() -> None:
    if os.getenv("CUTSET_INTEGRATION_WRITEBACK") != "1":
        pytest.skip("CUTSET_INTEGRATION_WRITEBACK=1 is required for mutations")
    dataset_urn = os.environ["CUTSET_INTEGRATION_DATASET"]
    old_column = os.getenv("CUTSET_INTEGRATION_COLUMN", "email")
    change = ColumnRename(
        _model_name(dataset_urn),
        old_column,
        f"{old_column}_address",
        "models/schema.yml",
    )
    gateway = DataHubGateway.from_env()
    evidence = gateway.collect_evidence(change)
    key = analysis_key("cutset/live-integration", "base", "head")
    report = ImpactReport(
        analysis_key=key,
        repository="cutset/live-integration",
        base="base",
        head="head",
        change=change,
        evidence=evidence,
        decision=decide(evidence),
    )
    tag_name = os.getenv("CUTSET_RISK_TAG", "cutset-at-risk")

    first = gateway.write_back(report, tag_name=tag_name)
    for _ in range(10):
        if gateway._existing_document_urn(key) == first.document_urn:
            break
        time.sleep(2)
    second = gateway.write_back(report, tag_name=tag_name)

    assert second.document_urn == first.document_urn
    assert second.updated_existing_document is True
