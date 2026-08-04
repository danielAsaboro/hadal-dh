from cutset.domain import (
    AssetContext,
    AssetRef,
    ImpactEvidence,
    LineagePath,
    QualitySummary,
    UsageQuery,
)
from cutset.ranking import rank_impacts


SOURCE = AssetRef("urn:li:dataset:customers", "dataset", "customers")


def test_ml_quality_usage_and_missing_owner_factors_are_additive() -> None:
    model = AssetRef("urn:li:mlModel:churn", "mlModel", "churn")
    system_query = UsageQuery(
        "urn:li:query:q1",
        "SYSTEM",
        "SQL",
        "production churn features",
        "SELECT email FROM analytics.customers WHERE region = ?",
        (SOURCE.urn,),
    )
    evidence = ImpactEvidence(
        source=SOURCE,
        lineage_paths=(
            LineagePath(
                SOURCE,
                model,
                "email",
                degree="3",
                downstream_columns=("email_hash",),
            ),
        ),
        complete=True,
        asset_contexts=(
            AssetContext(asset=SOURCE),
            AssetContext(
                asset=model,
                incident_statuses=("FAIL",),
                query_total=25,
                queries=(system_query,),
                quality=QualitySummary(total=2, failing=1),
            ),
        ),
    )

    ranked = rank_impacts(evidence)

    assert ranked[0].score == 230
    assert ranked[0].factors == (
        "ml_asset",
        "column_mapping",
        "quality_failure",
        "incident_failure",
        "production_usage",
        "usage_volume",
        "missing_owner",
    )


def test_equal_scores_sort_by_urn() -> None:
    asset_b = AssetRef("urn:li:dataset:b", "dataset", "b")
    asset_a = AssetRef("urn:li:dataset:a", "dataset", "a")
    owner = AssetRef("urn:li:corpuser:owner", "corpuser", "Owner")
    evidence = ImpactEvidence(
        source=SOURCE,
        lineage_paths=(
            LineagePath(SOURCE, asset_b, "email", downstream_columns=("email",)),
            LineagePath(SOURCE, asset_a, "email", downstream_columns=("email",)),
        ),
        complete=True,
        asset_contexts=(
            AssetContext(asset=asset_b, owners=(owner,)),
            AssetContext(asset=asset_a, owners=(owner,)),
        ),
    )

    ranked = rank_impacts(evidence)

    assert [item.asset.urn for item in ranked] == [asset_a.urn, asset_b.urn]


def test_source_asset_is_not_ranked_as_downstream_impact() -> None:
    evidence = ImpactEvidence(
        source=SOURCE,
        lineage_paths=(),
        complete=True,
        asset_contexts=(AssetContext(asset=SOURCE),),
    )

    assert rank_impacts(evidence) == ()
