"""Deterministic urgency ranking over already-verified impact evidence."""

from cutset.domain import ImpactEvidence, RankedImpact


_FAILING_HEALTH = frozenset({"FAIL", "FAILING", "ERROR"})
_ML_TYPES = frozenset({"mlFeature", "mlModel"})


def rank_impacts(evidence: ImpactEvidence) -> tuple[RankedImpact, ...]:
    """Rank unique downstream targets without changing merge safety policy."""
    contexts = {context.asset.urn: context for context in evidence.asset_contexts}
    paths = {path.downstream.urn: path for path in evidence.lineage_paths}
    ranked: list[RankedImpact] = []
    for urn, path in paths.items():
        asset = path.downstream
        score = 0
        factors: list[str] = []
        if asset.asset_type in _ML_TYPES:
            score += 100
            factors.append("ml_asset")
        if path.downstream_columns:
            score += 40
            factors.append("column_mapping")

        context = contexts.get(urn)
        if context is not None and context.complete:
            if context.quality.failing or context.quality.errors:
                score += 30
                factors.append("quality_failure")
            if set(context.incident_statuses) & _FAILING_HEALTH:
                score += 25
                factors.append("incident_failure")
            if any(query.source == "SYSTEM" for query in context.queries):
                score += 20
                factors.append("production_usage")
            if context.query_total:
                score += min(context.query_total, 10)
                factors.append("usage_volume")
            if not context.owners:
                score += 5
                factors.append("missing_owner")
        ranked.append(RankedImpact(asset, score, tuple(factors)))
    ranked.sort(key=lambda item: (-item.score, item.asset.urn))
    return tuple(ranked)
