import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cutset.domain import ColumnRename, ImpactDecision, ImpactEvidence
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
        "evidence": {
            "complete": report.evidence.complete,
            "source": _asset(report.evidence.source),
            "schema_fields": sorted(report.evidence.schema_fields),
            "lineage_paths": [
                {
                    "column": path.column,
                    "source": _asset(path.source),
                    "downstream": _asset(path.downstream),
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
        }
    return payload


def render_json(report: ImpactReport) -> str:
    return json.dumps(_payload(report), indent=2, sort_keys=True) + "\n"


def render_markdown(report: ImpactReport) -> str:
    verdict = "BLOCK" if report.decision.blocks_merge else "PASS"
    lines = [
        "# Cutset impact review",
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
        lines.extend(
            f"- `{path.downstream.asset_type}` — `{path.downstream.urn}`"
            for path in report.evidence.lineage_paths
        )
    else:
        lines.append("- No downstream column consumers returned.")

    if report.remediation is not None:
        validity = "VALID" if report.remediation.validation.valid else "INVALID"
        lines.extend(
            [
                "",
                f"## Suggested compatibility patch: {validity}",
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
