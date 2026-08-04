import json
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass

import yaml

from cutset.domain import ImpactDecision, ImpactEvidence


@dataclass(frozen=True, slots=True)
class RemediationDraft:
    sql: str
    schema_yaml: str
    explanation: str


@dataclass(frozen=True, slots=True)
class ValidationResult:
    valid: bool
    errors: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class GeneratedRemediation:
    draft: RemediationDraft
    validation: ValidationResult


_ALIAS_QUERY = re.compile(
    r"^\s*select\s+(?P<source>[A-Za-z_][A-Za-z0-9_]*)\s+as\s+"
    r"(?P<target>[A-Za-z_][A-Za-z0-9_]*)\s+from\s+"
    r"(?P<relation>[A-Za-z_][A-Za-z0-9_.]*)\s*$",
    re.IGNORECASE,
)
_UNSAFE_SQL = re.compile(
    r"\b(?:alter|create|delete|drop|insert|merge|truncate|update)\b",
    re.IGNORECASE,
)


def _validate_sql(draft: RemediationDraft, evidence: ImpactEvidence) -> list[str]:
    if evidence.change is None:
        return ["impact evidence omitted the verified column rename"]
    if ";" in draft.sql:
        return ["remediation SQL must contain exactly one statement without semicolons"]
    if "--" in draft.sql or "/*" in draft.sql or "*/" in draft.sql:
        return ["remediation SQL comments are not allowed"]
    if _UNSAFE_SQL.search(draft.sql):
        return ["remediation SQL may not contain DDL or DML"]
    match = _ALIAS_QUERY.fullmatch(draft.sql)
    if match is None:
        return ["remediation SQL must be one compatibility alias SELECT"]

    errors: list[str] = []
    source = match.group("source")
    target = match.group("target")
    allowed_sources = set(evidence.schema_fields) | {evidence.change.old_name}
    if source not in allowed_sources:
        errors.append(f"unverified source column: {source}")
    if target != evidence.change.new_name:
        errors.append(
            f"alias target must be the verified new column: {evidence.change.new_name}"
        )
    return errors


def _validate_schema_yaml(draft: RemediationDraft, evidence: ImpactEvidence) -> list[str]:
    if evidence.change is None:
        return ["impact evidence omitted the verified column rename"]
    try:
        document = yaml.safe_load(draft.schema_yaml)
    except yaml.YAMLError as error:
        return [f"schema YAML is invalid: {error.problem or 'parse error'}"]
    if not isinstance(document, Mapping):
        return ["schema YAML must be an object"]
    models = document.get("models")
    if not isinstance(models, list):
        return ["schema YAML must contain models"]

    for model in models:
        if not isinstance(model, Mapping) or model.get("name") != evidence.change.model_name:
            continue
        columns = model.get("columns")
        if not isinstance(columns, list):
            break
        for column in columns:
            if not isinstance(column, Mapping):
                continue
            if column.get("name") == evidence.change.new_name:
                tests = column.get("tests")
                if isinstance(tests, list) and tests:
                    return []
                return [f"column {evidence.change.new_name} must include at least one dbt test"]
    return [
        f"schema YAML must document verified model {evidence.change.model_name} "
        f"and column {evidence.change.new_name}"
    ]


def validate_remediation(
    draft: RemediationDraft,
    evidence: ImpactEvidence,
) -> ValidationResult:
    errors = _validate_sql(draft, evidence) + _validate_schema_yaml(draft, evidence)
    return ValidationResult(valid=not errors, errors=tuple(errors))


def parse_remediation_response(response: str) -> RemediationDraft:
    try:
        payload = json.loads(response)
    except json.JSONDecodeError as error:
        raise ValueError("model response must be exactly one JSON object") from error
    expected = {"sql", "schema_yaml", "explanation"}
    if not isinstance(payload, dict) or set(payload) != expected:
        raise ValueError("model response JSON object must contain exactly sql, schema_yaml, and explanation")
    if not all(isinstance(payload[key], str) for key in expected):
        raise ValueError("all remediation response fields must be strings")
    return RemediationDraft(
        sql=payload["sql"],
        schema_yaml=payload["schema_yaml"],
        explanation=payload["explanation"],
    )


def generate_remediation(
    evidence: ImpactEvidence,
    decision: ImpactDecision,
    model: Callable[[str], str],
) -> GeneratedRemediation:
    if evidence.change is None:
        raise ValueError("cannot generate remediation without a verified change")
    prompt = json.dumps(
        {
            "instruction": "Return only JSON with sql, schema_yaml, and explanation.",
            "model": evidence.change.model_name,
            "old_column": evidence.change.old_name,
            "new_column": evidence.change.new_name,
            "verified_schema_fields": sorted(evidence.schema_fields),
            "downstream_urns": sorted(
                path.downstream.urn for path in evidence.lineage_paths
            ),
            "reason": decision.reason.value,
        },
        sort_keys=True,
    )
    draft = parse_remediation_response(model(prompt))
    return GeneratedRemediation(
        draft=draft,
        validation=validate_remediation(draft, evidence),
    )
