from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from cutset.change_detection import parse_column_rename
from cutset.domain import ColumnRename, ImpactEvidence
from cutset.git_adapter import GitDiffRequest, read_git_diff, resolve_git_revision
from cutset.policy import analysis_key, decide
from cutset.ranking import rank_impacts
from cutset.remediation import (
    GeneratedRemediation,
    RemediationDraft,
    generate_remediation,
    select_remediation_grounding,
    validate_remediation,
)
from cutset.reporting import ImpactReport


class EvidenceGateway(Protocol):
    def collect_evidence(
        self, change: ColumnRename, max_hops: int = 3
    ) -> ImpactEvidence: ...


@dataclass(frozen=True, slots=True)
class AnalysisRequest:
    repo: Path
    base: str
    head: str
    repository_id: str


def _deterministic_remediation(evidence: ImpactEvidence) -> GeneratedRemediation:
    if evidence.change is None:
        raise ValueError("verified change is required for remediation")
    change = evidence.change
    grounding = select_remediation_grounding(evidence)
    draft = RemediationDraft(
        sql=(
            f"select {change.old_name} as {change.new_name} "
            f"from {grounding.relation}"
        ),
        schema_yaml=(
            "version: 2\n"
            "models:\n"
            f"  - name: {change.model_name}\n"
            "    columns:\n"
            f"      - name: {change.new_name}\n"
            "        tests:\n"
            "          - not_null\n"
        ),
        explanation=(
            "Compatibility alias grounded in observed DataHub SQL usage."
            if grounding.mode == "query_grounded"
            else "Compatibility alias grounded in the verified DataHub schema."
        ),
        grounding_mode=grounding.mode,
        supporting_query_urn=grounding.query_urn,
    )
    return GeneratedRemediation(draft, validate_remediation(draft, evidence))


def analyze(
    request: AnalysisRequest,
    gateway: EvidenceGateway,
    model: Callable[[str], str] | None = None,
) -> ImpactReport:
    base_sha = resolve_git_revision(request.repo, request.base)
    head_sha = resolve_git_revision(request.repo, request.head)
    diff = read_git_diff(GitDiffRequest(request.repo, request.base, request.head))
    change = parse_column_rename(diff)
    evidence = gateway.collect_evidence(change)
    decision = decide(evidence)
    remediation = None
    if evidence.complete and decision.blocks_merge:
        remediation = (
            generate_remediation(evidence, decision, model)
            if model is not None
            else _deterministic_remediation(evidence)
        )
    return ImpactReport(
        analysis_key=analysis_key(request.repository_id, base_sha, head_sha),
        repository=request.repository_id,
        base=base_sha,
        head=head_sha,
        change=change,
        evidence=evidence,
        decision=decision,
        remediation=remediation,
        ranked_impacts=rank_impacts(evidence),
    )
