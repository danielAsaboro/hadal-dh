import json
from collections.abc import Iterable, Mapping
from typing import Any

from datahub.sdk.main_client import DataHubClient
from datahub_agent_context.langchain_tools import build_langchain_tools

from cutset.domain import AssetRef, ColumnRename, ImpactEvidence, LineagePath


class DataHubContextError(RuntimeError):
    """Raised when DataHub cannot provide grounded, trustworthy context."""


def _as_mapping(value: object, operation: str) -> Mapping[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise DataHubContextError(f"{operation} returned invalid JSON") from error
    if not isinstance(value, Mapping):
        raise DataHubContextError(f"{operation} returned an unexpected response")
    return value


def _entity_type(entity: Mapping[str, Any]) -> str:
    raw_type = str(entity.get("type") or "").replace("_", "").lower()
    if not raw_type:
        urn = str(entity.get("urn") or "")
        raw_type = urn.removeprefix("urn:li:").split(":", 1)[0].lower()
    return {
        "dataset": "dataset",
        "mlfeature": "mlFeature",
        "mlmodel": "mlModel",
    }.get(raw_type, raw_type)


def _asset_from_entity(entity: Mapping[str, Any]) -> AssetRef:
    urn = entity.get("urn")
    if not isinstance(urn, str) or not urn.startswith("urn:li:"):
        raise DataHubContextError("DataHub entity response omitted a valid URN")
    properties = entity.get("properties")
    property_name = properties.get("name") if isinstance(properties, Mapping) else None
    name = property_name or entity.get("name") or urn
    return AssetRef(urn=urn, asset_type=_entity_type(entity), name=str(name))


def normalize_lineage(
    source: AssetRef,
    column: str,
    response: object,
) -> tuple[tuple[LineagePath, ...], bool]:
    """Normalize downstream lineage and expose any pagination as incompleteness."""
    payload = _as_mapping(response, "get_lineage")
    downstreams = _as_mapping(payload.get("downstreams", {}), "get_lineage")
    raw_results = downstreams.get("searchResults", [])
    if not isinstance(raw_results, list):
        raise DataHubContextError("get_lineage returned invalid search results")

    paths: list[LineagePath] = []
    for result in raw_results:
        if not isinstance(result, Mapping):
            raise DataHubContextError("get_lineage returned an invalid lineage result")
        entity = result.get("entity")
        if not isinstance(entity, Mapping):
            raise DataHubContextError("get_lineage result omitted its entity")
        paths.append(
            LineagePath(
                source=source,
                downstream=_asset_from_entity(entity),
                column=column,
            )
        )

    returned = downstreams.get("returned", len(raw_results))
    total = downstreams.get("total", returned)
    complete = not bool(
        downstreams.get("hasMore")
        or downstreams.get("truncatedDueToTokenBudget")
        or (isinstance(total, int) and isinstance(returned, int) and returned < total)
    )
    return tuple(paths), complete


class DataHubGateway:
    def __init__(self, client: object, tools: Iterable[object]) -> None:
        self.client = client
        self.tools = {
            str(tool.name): tool for tool in tools if isinstance(tool.name, str)
        }

    @classmethod
    def from_env(cls) -> "DataHubGateway":
        client = DataHubClient.from_env()
        return cls(
            client=client,
            tools=build_langchain_tools(client, include_mutations=True),
        )

    def _invoke(self, name: str, arguments: dict[str, object]) -> object:
        tool = self.tools.get(name)
        if tool is None:
            raise DataHubContextError(f"required DataHub tool is unavailable: {name}")
        try:
            return tool.invoke(arguments)
        except Exception as error:
            raise DataHubContextError(f"DataHub {name} operation failed") from error

    def _resolve_source(self, model_name: str) -> AssetRef:
        response = _as_mapping(
            self._invoke(
                "search",
                {
                    "query": f"/q {model_name}",
                    "filter": "entity_type = dataset",
                    "num_results": 10,
                    "offset": 0,
                },
            ),
            "search",
        )
        raw_results = response.get("searchResults", [])
        if not isinstance(raw_results, list):
            raise DataHubContextError("search returned invalid results")

        candidates: list[AssetRef] = []
        for result in raw_results:
            if not isinstance(result, Mapping):
                continue
            entity = result.get("entity")
            if not isinstance(entity, Mapping):
                continue
            candidate = _asset_from_entity(entity)
            if candidate.name.rsplit(".", 1)[-1] == model_name:
                candidates.append(candidate)

        unique = {candidate.urn: candidate for candidate in candidates}
        if len(unique) != 1:
            raise DataHubContextError(
                f"expected exactly one DataHub dataset for model {model_name}"
            )
        return next(iter(unique.values()))

    def collect_evidence(
        self,
        change: ColumnRename,
        max_hops: int = 3,
    ) -> ImpactEvidence:
        if not 1 <= max_hops <= 3:
            raise DataHubContextError("max_hops must be between 1 and 3")
        source = self._resolve_source(change.model_name)

        entities = self._invoke("get_entities", {"urns": [source.urn]})
        if not isinstance(entities, list) or len(entities) != 1:
            raise DataHubContextError("get_entities did not confirm the resolved dataset")
        confirmed = entities[0]
        if not isinstance(confirmed, Mapping) or confirmed.get("urn") != source.urn:
            raise DataHubContextError("get_entities did not confirm the resolved dataset")

        schema = _as_mapping(
            self._invoke(
                "list_schema_fields",
                {
                    "urn": source.urn,
                    "keywords": [change.old_name],
                    "limit": 100,
                    "offset": 0,
                },
            ),
            "list_schema_fields",
        )
        raw_fields = schema.get("fields", [])
        if not isinstance(raw_fields, list) or not any(
            isinstance(field, Mapping) and field.get("fieldPath") == change.old_name
            for field in raw_fields
        ):
            raise DataHubContextError(
                f"verified DataHub schema does not contain column {change.old_name}"
            )
        schema_complete = schema.get("remainingCount", 0) == 0
        schema_fields = tuple(
            str(field["fieldPath"])
            for field in raw_fields
            if isinstance(field, Mapping) and isinstance(field.get("fieldPath"), str)
        )

        lineage = self._invoke(
            "get_lineage",
            {
                "urn": source.urn,
                "column": change.old_name,
                "upstream": False,
                "max_hops": max_hops,
                "max_results": 50,
                "offset": 0,
            },
        )
        paths, lineage_complete = normalize_lineage(source, change.old_name, lineage)
        return ImpactEvidence(
            source=source,
            lineage_paths=paths,
            complete=schema_complete and lineage_complete,
            change=change,
            schema_fields=schema_fields,
        )
