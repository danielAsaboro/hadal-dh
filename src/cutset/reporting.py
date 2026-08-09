import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cutset.domain import ColumnRename, ImpactDecision, ImpactEvidence, RankedImpact
from cutset.remediation import GeneratedRemediation


@dataclass(frozen=True, slots=True)
class ImpactReport:
    analysis_key: str
    repository: str
    base: str
    head: str
    change: ColumnRename
    evidence: ImpactEvidence
    decision: ImpactDecision
    remediation: GeneratedRemediation | None = None
    ranked_impacts: tuple[RankedImpact, ...] = ()


def _asset(asset: object) -> dict[str, str]:
    return {
        "urn": str(getattr(asset, "urn")),
        "asset_type": str(getattr(asset, "asset_type")),
        "name": str(getattr(asset, "name")),
    }


def _payload(report: ImpactReport) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "analysis_key": report.analysis_key,
        "repository": report.repository,
        "base": report.base,
        "head": report.head,
        "change": {
            "model_name": report.change.model_name,
            "old_name": report.change.old_name,
            "new_name": report.change.new_name,
            "source_path": report.change.source_path,
        },
        "decision": {
            "severity": report.decision.severity.value,
            "blocks_merge": report.decision.blocks_merge,
            "reason": report.decision.reason.value,
        },
        "ranked_impacts": [
            {
                "asset": _asset(item.asset),
                "score": item.score,
                "factors": list(item.factors),
            }
            for item in report.ranked_impacts
        ],
        "evidence": {
            "complete": report.evidence.complete,
            "source": _asset(report.evidence.source),
            "schema_fields": sorted(report.evidence.schema_fields),
            "asset_contexts": [
                {
                    "asset": _asset(context.asset),
                    "owners": [_asset(owner) for owner in context.owners],
                    "tags": [_asset(tag) for tag in context.tags],
                    "glossary_terms": [
                        _asset(term) for term in context.glossary_terms
                    ],
                    "incident_statuses": list(context.incident_statuses),
                    "query_total": context.query_total,
                    "queries": [
                        {
                            "urn": query.urn,
                            "source": query.source,
                            "language": query.language,
                            "name": query.name,
                            "statement": query.statement,
                            "subjects": list(query.subjects),
                        }
                        for query in context.queries
                    ],
                    "quality": {
                        "total": context.quality.total,
                        "failing": context.quality.failing,
                        "errors": context.quality.errors,
                        "sample": [
                            {
                                "urn": assertion.urn,
                                "assertion_type": assertion.assertion_type,
                                "column": assertion.column,
                                "status": assertion.status,
                            }
                            for assertion in context.quality.sample
                        ],
                    },
                    "complete": context.complete,
                }
                for context in report.evidence.asset_contexts
            ],
            "lineage_paths": [
                {
                    "column": path.column,
                    "degree": path.degree,
                    "downstream_columns": list(path.downstream_columns),
                    "source": _asset(path.source),
                    "downstream": _asset(path.downstream),
                    "nodes": [_asset(node) for node in path.nodes],
                }
                for path in report.evidence.lineage_paths
            ],
        },
    }
    if report.remediation is not None:
        payload["remediation"] = {
            "sql": report.remediation.draft.sql,
            "schema_yaml": report.remediation.draft.schema_yaml,
            "explanation": report.remediation.draft.explanation,
            "valid": report.remediation.validation.valid,
            "errors": list(report.remediation.validation.errors),
            "grounding_mode": report.remediation.draft.grounding_mode,
            "supporting_query_urn": report.remediation.draft.supporting_query_urn,
        }
    return payload


def render_json(report: ImpactReport) -> str:
    return json.dumps(_payload(report), indent=2, sort_keys=True) + "\n"


def render_markdown(report: ImpactReport) -> str:
    verdict = "BLOCK" if report.decision.blocks_merge else "PASS"
    lines = [
        "# ChangeMarshal impact review",
        "",
        f"## Verdict: {verdict}",
        "",
        f"- Severity: `{report.decision.severity.value}`",
        f"- Reason: `{report.decision.reason.value}`",
        f"- Context complete: `{str(report.evidence.complete).lower()}`",
        f"- Change: `{report.change.model_name}.{report.change.old_name}` → `{report.change.new_name}`",
        f"- Source: `{report.evidence.source.urn}`",
        "",
        "## Downstream evidence",
        "",
    ]
    if report.evidence.lineage_paths:
        for path in report.evidence.lineage_paths:
            chain = " → ".join(
                f"`{node.urn}`" for node in path.nodes
            ) or f"`{path.downstream.urn}`"
            lines.append(f"- `{path.downstream.asset_type}` — {chain}")
    else:
        lines.append("- No downstream column consumers returned.")

    if report.ranked_impacts:
        lines.extend(["", "## Ranked impact", ""])
        for item in report.ranked_impacts:
            factors = ", ".join(item.factors)
            lines.append(
                f"- `{item.asset.name}` — score `{item.score}` — {factors}"
            )

    if report.evidence.asset_contexts:
        lines.extend(["", "## DataHub context", ""])
        for context in report.evidence.asset_contexts:
            owners = ", ".join(owner.name for owner in context.owners) or "unowned"
            tags = ", ".join(tag.name for tag in context.tags) or "none"
            terms = ", ".join(term.name for term in context.glossary_terms) or "none"
            incidents = ", ".join(context.incident_statuses) or "none"
            lines.extend(
                [
                    f"### {context.asset.name}",
                    "",
                    f"- Owners: {owners}",
                    f"- Tags: {tags}",
                    f"- Glossary terms: {terms}",
                    f"- Usage queries: `{context.query_total}`",
                    (
                        "- Quality: "
                        f"`{context.quality.failing}` failing, "
                        f"`{context.quality.errors}` errors"
                    ),
                    f"- Incident statuses: {incidents}",
                    f"- Context complete: `{str(context.complete).lower()}`",
                    "",
                ]
            )

    if report.remediation is not None:
        validity = "VALID" if report.remediation.validation.valid else "INVALID"
        lines.extend(
            [
                "",
                f"## Suggested compatibility patch: {validity}",
                "",
                f"- Grounding: `{report.remediation.draft.grounding_mode}`",
                f"- Supporting query: `{report.remediation.draft.supporting_query_urn or 'none'}`",
                "",
                "```sql",
                report.remediation.draft.sql,
                "```",
                "",
                "```yaml",
                report.remediation.draft.schema_yaml.rstrip(),
                "```",
            ]
        )
    lines.extend(
        [
            "",
            f"CUTSET ANALYSIS KEY: `{report.analysis_key}`",
            "",
        ]
    )
    return "\n".join(lines)


def write_reports(report: ImpactReport, output: Path) -> tuple[Path, Path]:
    output.mkdir(parents=True, exist_ok=True)
    json_path = output / "impact-report.json"
    markdown_path = output / "impact-report.md"
    json_path.write_text(render_json(report))
    markdown_path.write_text(render_markdown(report))
    return json_path, markdown_path
