import pytest

from cutset.domain import (
    AssetRef,
    ImpactEvidence,
    LineagePath,
    ReasonCode,
    Severity,
)
from cutset.policy import analysis_key, decide


def _evidence(complete: bool, asset_types: tuple[str, ...]) -> ImpactEvidence:
    source = AssetRef(
        urn="urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)",
        asset_type="dataset",
        name="analytics.customers",
    )
    paths = tuple(
        LineagePath(
            source=source,
            downstream=AssetRef(
                urn=f"urn:li:{asset_type}:asset-{index}",
                asset_type=asset_type,
                name=f"asset-{index}",
            ),
            column="email",
        )
        for index, asset_type in enumerate(asset_types)
    )
    return ImpactEvidence(source=source, lineage_paths=paths, complete=complete)


@pytest.mark.parametrize(
    ("complete", "asset_types", "severity", "blocks", "reason"),
    [
        (False, (), Severity.BLOCKED, True, ReasonCode.CONTEXT_INCOMPLETE),
        (True, (), Severity.INFO, False, ReasonCode.NO_DOWNSTREAM_CONSUMERS),
        (True, ("dataset",), Severity.HIGH, True, ReasonCode.DOWNSTREAM_COLUMN_CONSUMERS),
        (True, ("mlFeature", "mlModel"), Severity.CRITICAL, True, ReasonCode.ML_ASSETS_AFFECTED),
    ],
)
def test_decision_is_deterministic(
    complete: bool,
    asset_types: tuple[str, ...],
    severity: Severity,
    blocks: bool,
    reason: ReasonCode,
) -> None:
    evidence = _evidence(complete, asset_types)

    assert decide(evidence).severity is severity
    assert decide(evidence).blocks_merge is blocks
    assert decide(evidence).reason is reason


def test_analysis_key_is_stable() -> None:
    assert analysis_key("owner/repo", "abc", "def") == analysis_key(
        "owner/repo", "abc", "def"
    )
    assert analysis_key("owner/repo", "abc", "def") != analysis_key(
        "owner/repo", "abc", "xyz"
    )
    assert len(analysis_key("owner/repo", "abc", "def")) == 20
