"""Pure normalization for bounded DataHub governance and usage context."""

from collections.abc import Mapping, Sequence
from typing import Any

from sqlglot import exp, parse_one
from sqlglot.errors import ParseError

from cutset.domain import (
    AssertionSignal,
    AssetContext,
    AssetRef,
    QualitySummary,
    UsageQuery,
)


class ContextNormalizationError(ValueError):
    """Raised when DataHub context cannot support a trustworthy claim."""


def _mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ContextNormalizationError(f"{label} must be an object")
    return value


def _list(value: object, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise ContextNormalizationError(f"{label} must be a list")
    return value


def _urn(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.startswith("urn:li:"):
        raise ContextNormalizationError(f"{label} omitted a valid DataHub URN")
    return value


def _entity_type(urn: str) -> str:
    return urn.removeprefix("urn:li:").split(":", 1)[0].lower()


def _display_name(entity: Mapping[str, Any], urn: str) -> str:
    properties = entity.get("properties")
    editable = entity.get("editableProperties")
    info = entity.get("info")
    candidates = (
        properties.get("displayName") if isinstance(properties, Mapping) else None,
        properties.get("name") if isinstance(properties, Mapping) else None,
        editable.get("displayName") if isinstance(editable, Mapping) else None,
        info.get("displayName") if isinstance(info, Mapping) else None,
        entity.get("name"),
        entity.get("hierarchicalName"),
    )
    return next((str(value) for value in candidates if value), urn)


def _nested_assets(
    container: object,
    collection_key: str,
    entity_key: str,
) -> tuple[AssetRef, ...]:
    if container is None:
        return ()
    payload = _mapping(container, entity_key)
    values = _list(payload.get(collection_key, []), f"{entity_key}.{collection_key}")
    assets: dict[str, AssetRef] = {}
    for value in values:
        wrapper = _mapping(value, entity_key)
        entity = _mapping(wrapper.get(entity_key), entity_key)
        urn = _urn(entity.get("urn"), entity_key)
        assets[urn] = AssetRef(urn, _entity_type(urn), _display_name(entity, urn))
    return tuple(assets[urn] for urn in sorted(assets))


def normalize_entity_context(
    assets: Sequence[AssetRef],
    response: object,
) -> tuple[AssetContext, ...]:
    """Confirm exact entity coverage and normalize report-safe governance fields."""
    raw_entities = _list(response, "get_entities response")
    requested = {asset.urn: asset for asset in assets}
    if len(requested) != len(assets):
        raise ContextNormalizationError("requested URNs must be unique")

    returned: dict[str, Mapping[str, Any]] = {}
    for raw_entity in raw_entities:
        entity = _mapping(raw_entity, "entity")
        urn = _urn(entity.get("urn"), "entity")
        if entity.get("error") or urn not in requested or urn in returned:
            raise ContextNormalizationError("get_entities did not match requested URNs")
        returned[urn] = entity
    if set(returned) != set(requested):
        raise ContextNormalizationError("get_entities did not return all requested URNs")

    contexts: list[AssetContext] = []
    for asset in assets:
        urn = asset.urn
        entity = returned[urn]
        raw_health = _list(entity.get("health", []), "entity health")
        statuses: set[str] = set()
        for signal in raw_health:
            health = _mapping(signal, "health signal")
            status = health.get("status")
            if not isinstance(status, str) or not status:
                raise ContextNormalizationError("health signal omitted its status")
            statuses.add(status.upper())
        contexts.append(
            AssetContext(
                asset=asset,
                owners=_nested_assets(entity.get("ownership"), "owners", "owner"),
                tags=_nested_assets(entity.get("tags"), "tags", "tag"),
                glossary_terms=_nested_assets(
                    entity.get("glossaryTerms"), "terms", "term"
                ),
                incident_statuses=tuple(sorted(statuses)),
            )
        )
    return tuple(contexts)


def _redact_sql(statement: str) -> str:
    try:
        parsed = parse_one(statement)
    except ParseError as error:
        raise ContextNormalizationError("query statement is not valid SQL") from error
    redacted = parsed.transform(
        lambda node: exp.Placeholder() if isinstance(node, exp.Literal) else node
    ).sql()
    return redacted[:2000]


def _query_subjects(value: object) -> tuple[str, ...]:
    raw_subjects = _list(value, "query subjects")
    subjects: set[str] = set()
    for raw_subject in raw_subjects:
        if isinstance(raw_subject, str):
            subjects.add(_urn(raw_subject, "query subject"))
            continue
        subject = _mapping(raw_subject, "query subject")
        subjects.add(_urn(subject.get("urn") or subject.get("entity"), "query subject"))
    return tuple(sorted(subjects))


def normalize_queries(
    dataset: AssetRef,
    response: object,
) -> tuple[int, tuple[UsageQuery, ...]]:
    """Normalize a bounded query page while retaining the verified total."""
    payload = _mapping(response, "get_dataset_queries response")
    start, total, page_size = (
        payload.get("start"),
        payload.get("total"),
        payload.get("count"),
    )
    if (
        start != 0
        or not isinstance(total, int)
        or total < 0
        or not isinstance(page_size, int)
        or page_size < 1
    ):
        raise ContextNormalizationError("query pagination metadata is invalid")
    raw_queries = payload.get("queries", [])
    queries = _list(raw_queries, "queries")
    if total > 0 and not queries:
        raise ContextNormalizationError("query page omitted its queries")
    if len(queries) > page_size or len(queries) > total:
        raise ContextNormalizationError("query page exceeds its verified count")

    normalized: list[UsageQuery] = []
    seen: set[str] = set()
    for raw_query in queries:
        query = _mapping(raw_query, "query")
        urn = _urn(query.get("urn"), "query")
        if urn in seen:
            raise ContextNormalizationError("query page returned a duplicate URN")
        seen.add(urn)
        properties = _mapping(query.get("properties"), "query properties")
        statement = _mapping(properties.get("statement"), "query statement")
        raw_sql = statement.get("value")
        language = statement.get("language")
        source = properties.get("source")
        name = properties.get("name")
        if not isinstance(raw_sql, str) or not raw_sql.strip():
            raise ContextNormalizationError("query omitted its SQL statement")
        if language != "SQL" or source not in {"MANUAL", "SYSTEM"}:
            raise ContextNormalizationError("query language or source is unsupported")
        if name is not None and not isinstance(name, str):
            raise ContextNormalizationError("query name must be a string")
        subjects = _query_subjects(query.get("subjects", []))
        if dataset.urn not in subjects:
            raise ContextNormalizationError("query subjects omitted the requested dataset")
        normalized.append(
            UsageQuery(
                urn=urn,
                source=source,
                language=language,
                name=name,
                statement=_redact_sql(raw_sql),
                subjects=subjects,
            )
        )
    normalized.sort(key=lambda query: query.urn)
    return total, tuple(normalized)


def _assertion_page(response: object, label: str) -> tuple[int, list[Any]]:
    payload = _mapping(response, label)
    if payload.get("success") is not True:
        raise ContextNormalizationError(f"{label} did not succeed")
    data = _mapping(payload.get("data"), f"{label} data")
    start, count, total = data.get("start"), data.get("count"), data.get("total")
    assertions = _list(data.get("assertions"), f"{label} assertions")
    if (
        start != 0
        or not isinstance(count, int)
        or not isinstance(total, int)
        or count < 0
        or total < count
        or count != len(assertions)
    ):
        raise ContextNormalizationError(f"{label} count metadata is invalid")
    return total, assertions


def normalize_assertions(
    sample_response: object,
    failing_response: object,
    error_response: object,
) -> QualitySummary:
    """Normalize an assertion sample plus authoritative failing/error totals."""
    total, raw_sample = _assertion_page(sample_response, "assertion sample")
    failing, _ = _assertion_page(failing_response, "failing assertions")
    errors, _ = _assertion_page(error_response, "error assertions")
    sample: list[AssertionSignal] = []
    for raw_assertion in raw_sample:
        assertion = _mapping(raw_assertion, "assertion")
        urn = _urn(assertion.get("urn"), "assertion")
        assertion_type = assertion.get("type")
        status = assertion.get("latestResultType")
        column = assertion.get("column")
        if not isinstance(assertion_type, str) or not isinstance(status, str):
            raise ContextNormalizationError("assertion omitted its type or status")
        if column is not None and not isinstance(column, str):
            raise ContextNormalizationError("assertion column must be a string")
        sample.append(AssertionSignal(urn, assertion_type, column, status))
    sample.sort(key=lambda assertion: assertion.urn)
    return QualitySummary(total, failing, errors, tuple(sample))
