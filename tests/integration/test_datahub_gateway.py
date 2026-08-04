import os

import pytest

from cutset.datahub_gateway import DataHubGateway
from cutset.domain import ColumnRename


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
