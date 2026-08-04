import hashlib

from cutset.domain import ImpactDecision, ImpactEvidence, ReasonCode, Severity


_ML_ASSET_TYPES = frozenset({"mlFeature", "mlModel"})


def decide(evidence: ImpactEvidence) -> ImpactDecision:
    """Classify normalized impact evidence without network or model calls."""
    if not evidence.complete:
        return ImpactDecision(
            severity=Severity.BLOCKED,
            blocks_merge=True,
            reason=ReasonCode.CONTEXT_INCOMPLETE,
        )

    downstream_types = {path.downstream.asset_type for path in evidence.lineage_paths}
    if downstream_types & _ML_ASSET_TYPES:
        return ImpactDecision(
            severity=Severity.CRITICAL,
            blocks_merge=True,
            reason=ReasonCode.ML_ASSETS_AFFECTED,
        )

    if evidence.lineage_paths:
        return ImpactDecision(
            severity=Severity.HIGH,
            blocks_merge=True,
            reason=ReasonCode.DOWNSTREAM_COLUMN_CONSUMERS,
        )

    return ImpactDecision(
        severity=Severity.INFO,
        blocks_merge=False,
        reason=ReasonCode.NO_DOWNSTREAM_CONSUMERS,
    )


def analysis_key(repository: str, base_sha: str, head_sha: str) -> str:
    """Return the stable identifier for one versioned analysis input."""
    canonical = f"cutset-analysis-v1\n{repository}\n{base_sha}\n{head_sha}\n"
    return hashlib.sha256(canonical.encode()).hexdigest()[:20]
