import json
import warnings
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, replace
from typing import Any

from datahub.errors import ExperimentalWarning
from datahub.metadata.urns import DatasetUrn, TagUrn
from datahub.utilities.urns.error import InvalidUrnError

warnings.filterwarnings("ignore", category=ExperimentalWarning)

from datahub.sdk.main_client import DataHubClient
from datahub_agent_context.langchain_tools import build_langchain_tools

from cutset.context import (
    ContextNormalizationError,
    normalize_assertions,
    normalize_entity_context,
    normalize_queries,
)
from cutset.domain import AssetContext, AssetRef, ColumnRename, ImpactEvidence, LineagePath
from cutset.policy import decide
from cutset.reporting import ImpactReport, render_markdown


class DataHubContextError(RuntimeError):
    """Raised when DataHub cannot provide grounded, trustworthy context."""


class DataHubWriteBackError(RuntimeError):
    """Raised when a guarded DataHub mutation does not fully succeed."""

    def __init__(
        self,
        message: str,
        *,
        document_saved: bool = False,
        document_urn: str | None = None,
        tags_applied: bool = False,
    ) -> None:
        super().__init__(message)
        self.document_saved = document_saved
        self.document_urn = document_urn
        self.tags_applied = tags_applied


@dataclass(frozen=True, slots=True)
class WriteBackResult:
    success: bool
    document_urn: str
    tagged_urns: tuple[str, ...]
    updated_existing_document: bool


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
    name = property_name or entity.get("name") or entity.get("fieldPath") or urn
    return AssetRef(urn=urn, asset_type=_entity_type(entity), name=str(name))


def normalize_lineage(
    source: AssetRef,
    column: str,
    response: object,
) -> tuple[tuple[LineagePath, ...], bool]:
    """Normalize downstream lineage and expose any pagination as incompleteness."""
    payload = _as_mapping(response, "get_lineage")
    raw_downstreams = payload.get("downstreams")
    if not isinstance(raw_downstreams, Mapping):
        return (), False
    downstreams = raw_downstreams
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
                degree=str(result.get("degree", "unknown")),
                downstream_columns=tuple(
                    str(value)
                    for value in result.get("lineageColumns", [])
                    if isinstance(value, str)
                )
                if isinstance(result.get("lineageColumns", []), list)
                else (),
            )
        )

    returned = downstreams.get("returned")
    total = downstreams.get("total")
    has_more = downstreams.get("hasMore")
    offset = downstreams.get("offset")
    metadata_complete = (
        isinstance(returned, int)
        and isinstance(total, int)
        and isinstance(has_more, bool)
        and isinstance(offset, int)
        and returned == len(raw_results)
    )
    explicitly_empty = (
        not raw_results
        and downstreams.get("start") == 0
        and downstreams.get("count") == 0
        and downstreams.get("total") == 0
    )
    complete = (metadata_complete or explicitly_empty) and not bool(
        has_more
        or downstreams.get("truncatedDueToTokenBudget")
        or (isinstance(total, int) and isinstance(returned, int) and returned < total)
    )
    return tuple(paths), complete


def _normalize_exact_paths(
    summary: LineagePath,
    response: object,
) -> tuple[LineagePath, ...]:
    payload = _as_mapping(response, "get_lineage_paths_between")
    metadata = payload.get("metadata")
    target = payload.get("target")
    raw_paths = payload.get("paths")
    path_count = payload.get("pathCount")
    if (
        not isinstance(metadata, Mapping)
        or metadata.get("direction") != "downstream"
        or not isinstance(target, Mapping)
        or target.get("urn") != summary.downstream.urn
        or not isinstance(raw_paths, list)
        or not isinstance(path_count, int)
        or path_count != len(raw_paths)
        or path_count < 1
    ):
        raise DataHubContextError("exact lineage path response is incomplete")

    normalized: list[LineagePath] = []
    for raw_path in raw_paths:
        if not isinstance(raw_path, Mapping) or not isinstance(raw_path.get("path"), list):
            raise DataHubContextError("exact lineage path response is malformed")
        raw_nodes = raw_path["path"]
        if not raw_nodes or not all(isinstance(node, Mapping) for node in raw_nodes):
            raise DataHubContextError("exact lineage path omitted path nodes")
        normalized.append(
            LineagePath(
                source=summary.source,
                downstream=summary.downstream,
                column=summary.column,
                degree=summary.degree,
                downstream_columns=summary.downstream_columns,
                nodes=tuple(_asset_from_entity(node) for node in raw_nodes),
            )
        )
    return tuple(normalized)


class DataHubGateway:
    def __init__(self, client: object, tools: Iterable[object]) -> None:
        self.client = client
        self.tools = {
            str(tool.name): tool for tool in tools if isinstance(tool.name, str)
        }

    @classmethod
    def from_env(cls) -> "DataHubGateway":
        try:
            client = DataHubClient.from_env()
            return cls(
                client=client,
                tools=build_langchain_tools(client, include_mutations=True),
            )
        except Exception as error:
            raise DataHubContextError("could not initialize the DataHub client") from error

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
        total = response.get("total")
        if not isinstance(total, int) or total > len(raw_results):
            raise DataHubContextError("DataHub asset search results are incomplete")

        candidates: list[AssetRef] = []
        for result in raw_results:
            if not isinstance(result, Mapping):
                continue
            entity = result.get("entity")
            if not isinstance(entity, Mapping):
                continue
            candidate = _asset_from_entity(entity)
            logical_name = ""
            try:
                logical_name = DatasetUrn.from_string(candidate.urn).name
            except (InvalidUrnError, ValueError):
                continue
            if (
                candidate.name.rsplit(".", 1)[-1].casefold() == model_name.casefold()
                or logical_name.rsplit(".", 1)[-1].casefold()
                == model_name.casefold()
            ):
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
        bridged_paths: list[LineagePath] = []
        bridge_complete = True
        governed_types = {"mlFeature", "mlModel"}
        if lineage_complete:
            seen_targets = {
                path.downstream.urn
                for path in paths
                if path.downstream.asset_type in governed_types
            }
            for dataset_path in paths:
                if dataset_path.downstream.asset_type != "dataset":
                    continue
                try:
                    traversed_hops = int(dataset_path.degree)
                except ValueError:
                    bridge_complete = False
                    continue
                if traversed_hops < 1:
                    bridge_complete = False
                    continue
                remaining_hops = max_hops - traversed_hops
                if remaining_hops < 1:
                    continue
                downstream_lineage = self._invoke(
                    "get_lineage",
                    {
                        "urn": dataset_path.downstream.urn,
                        "upstream": False,
                        "max_hops": remaining_hops,
                        "max_results": 50,
                        "offset": 0,
                    },
                )
                downstream_paths, downstream_complete = normalize_lineage(
                    source, change.old_name, downstream_lineage
                )
                bridge_complete = bridge_complete and downstream_complete
                for downstream_path in downstream_paths:
                    try:
                        downstream_hops = int(downstream_path.degree)
                    except ValueError:
                        bridge_complete = False
                        continue
                    if downstream_hops < 1:
                        bridge_complete = False
                        continue
                    downstream_path = replace(
                        downstream_path,
                        degree=str(traversed_hops + downstream_hops),
                    )
                    if (
                        downstream_path.downstream.asset_type in governed_types
                        and downstream_path.downstream.urn not in seen_targets
                    ):
                        seen_targets.add(downstream_path.downstream.urn)
                        bridged_paths.append(downstream_path)

        paths = (*paths, *bridged_paths)
        lineage_complete = lineage_complete and bridge_complete
        exact_paths: list[LineagePath] = []
        if lineage_complete:
            for summary in paths:
                target_columns: tuple[str | None, ...] = (
                    summary.downstream_columns
                    if summary.downstream_columns
                    else (None,)
                )
                for target_column in target_columns:
                    arguments: dict[str, object] = {
                        "source_urn": source.urn,
                        "target_urn": summary.downstream.urn,
                        "direction": "downstream",
                    }
                    if target_column is not None:
                        arguments["source_column"] = change.old_name
                        arguments["target_column"] = target_column
                    response = self._invoke("get_lineage_paths_between", arguments)
                    exact_paths.extend(_normalize_exact_paths(summary, response))
        asset_contexts: tuple[AssetContext, ...] = ()
        context_complete = False
        if lineage_complete:
            asset_contexts, context_complete = self._collect_asset_contexts(
                source,
                tuple(exact_paths),
                change,
            )
        return ImpactEvidence(
            source=source,
            lineage_paths=tuple(exact_paths) if lineage_complete else paths,
            complete=schema_complete and lineage_complete and context_complete,
            change=change,
            schema_fields=schema_fields,
            asset_contexts=asset_contexts,
        )

    def _collect_asset_contexts(
        self,
        source: AssetRef,
        paths: tuple[LineagePath, ...],
        change: ColumnRename,
    ) -> tuple[tuple[AssetContext, ...], bool]:
        assets: dict[str, AssetRef] = {source.urn: source}
        relevant_columns: dict[str, set[str]] = {source.urn: {change.old_name}}
        for path in paths:
            assets[path.downstream.urn] = path.downstream
            if path.downstream.asset_type == "dataset":
                relevant_columns.setdefault(path.downstream.urn, set()).update(
                    path.downstream_columns
                )

        ordered_assets = (
            source,
            *(assets[urn] for urn in sorted(assets) if urn != source.urn),
        )
        try:
            entity_response = self._invoke(
                "get_entities", {"urns": [asset.urn for asset in ordered_assets]}
            )
            contexts = normalize_entity_context(ordered_assets, entity_response)
            enriched: list[AssetContext] = []
            for context in contexts:
                if context.asset.asset_type != "dataset":
                    enriched.append(context)
                    continue
                columns = sorted(relevant_columns.get(context.asset.urn, ()))
                column = columns[0] if columns else None
                query_arguments: dict[str, object] = {
                    "urn": context.asset.urn,
                    "start": 0,
                    "count": 10,
                }
                assertion_arguments: dict[str, object] = {
                    "urn": context.asset.urn,
                    "start": 0,
                    "count": 5,
                    "run_events_count": 1,
                }
                if column is not None:
                    query_arguments["column"] = column
                    assertion_arguments["column"] = column
                query_total, queries = normalize_queries(
                    context.asset,
                    self._invoke("get_dataset_queries", query_arguments),
                )
                sample = self._invoke(
                    "get_dataset_assertions", assertion_arguments
                )
                failing_arguments = {
                    **assertion_arguments,
                    "count": 1,
                    "status": "FAILING",
                }
                error_arguments = {
                    **assertion_arguments,
                    "count": 1,
                    "status": "ERROR",
                }
                quality = normalize_assertions(
                    sample,
                    self._invoke("get_dataset_assertions", failing_arguments),
                    self._invoke("get_dataset_assertions", error_arguments),
                )
                enriched.append(
                    replace(
                        context,
                        query_total=query_total,
                        queries=queries,
                        quality=quality,
                    )
                )
            return tuple(enriched), True
        except (ContextNormalizationError, DataHubContextError):
            return (
                tuple(AssetContext(asset=asset, complete=False) for asset in ordered_assets),
                False,
            )

    def _resolve_tag(self, tag_name: str) -> str:
        response = _as_mapping(
            self._invoke(
                "search",
                {
                    "query": f"/q {tag_name}",
                    "filter": "entity_type = tag",
                    "num_results": 10,
                    "offset": 0,
                },
            ),
            "search",
        )
        raw_results = response.get("searchResults", [])
        if not isinstance(raw_results, list):
            raise DataHubWriteBackError("tag search returned invalid results")
        total = response.get("total")
        if not isinstance(total, int) or total > len(raw_results):
            raise DataHubWriteBackError("tag search results are incomplete")
        matches: dict[str, AssetRef] = {}
        for result in raw_results:
            if not isinstance(result, Mapping):
                continue
            entity = result.get("entity")
            if not isinstance(entity, Mapping):
                continue
            asset = _asset_from_entity(entity)
            resolved_name = ""
            try:
                resolved_name = TagUrn.from_string(asset.urn).name
            except (InvalidUrnError, ValueError):
                pass
            if asset.asset_type == "tag" and resolved_name == tag_name:
                matches[asset.urn] = asset
        if len(matches) != 1:
            raise DataHubWriteBackError(
                f"expected exactly one existing DataHub tag named {tag_name}"
            )
        return next(iter(matches))

    def _existing_document_urn(self, analysis_key: str) -> str | None:
        response = _as_mapping(
            self._invoke(
                "search_documents",
                {
                    "query": f'/q "Cutset impact {analysis_key}"',
                    "num_results": 10,
                    "offset": 0,
                },
            ),
            "search_documents",
        )
        raw_results = response.get("searchResults", [])
        if not isinstance(raw_results, list):
            raise DataHubWriteBackError("document search returned invalid results")
        total = response.get("total")
        if not isinstance(total, int) or total > len(raw_results):
            raise DataHubWriteBackError("document search results are incomplete")
        expected_title = f"Cutset impact {analysis_key}"
        urns = {
            entity["urn"]
            for result in raw_results
            if isinstance(result, Mapping)
            and isinstance((entity := result.get("entity")), Mapping)
            and isinstance(entity.get("urn"), str)
            and isinstance(entity.get("info"), Mapping)
            and entity["info"].get("title") == expected_title
        }
        if len(urns) > 1:
            raise DataHubWriteBackError(
                f"multiple impact documents matched analysis key {analysis_key}"
            )
        return next(iter(urns), None)

    def write_back(
        self,
        report: ImpactReport,
        tag_name: str = "cutset-at-risk",
    ) -> WriteBackResult:
        """Persist an impact document and tag only assets read in this analysis."""
        if not report.evidence.complete:
            raise DataHubWriteBackError("write-back requires complete evidence")
        if report.decision != decide(report.evidence):
            raise DataHubWriteBackError(
                "write-back decision does not match deterministic policy"
            )
        if (
            report.remediation is not None
            and not report.remediation.validation.valid
        ):
            raise DataHubWriteBackError("write-back requires valid remediation")

        evidence_urns = [report.evidence.source.urn]
        evidence_urns.extend(
            path.downstream.urn for path in report.evidence.lineage_paths
        )
        target_urns = list(dict.fromkeys(evidence_urns))
        if not target_urns or any(not urn.startswith("urn:li:") for urn in target_urns):
            raise DataHubWriteBackError("write-back target was absent from current evidence")

        document_urn: str | None = None
        document_saved = False
        tags_applied = False
        try:
            tag_urn = (
                self._resolve_tag(tag_name)
                if report.decision.blocks_merge
                else None
            )
            existing_document = self._existing_document_urn(report.analysis_key)
            save_arguments: dict[str, object] = {
                "document_type": "Analysis",
                "title": f"Cutset impact {report.analysis_key}",
                "content": render_markdown(report),
                "topics": ["cutset", "schema-change", report.decision.severity.value],
                "related_assets": target_urns,
            }
            if existing_document is not None:
                save_arguments["urn"] = existing_document
            save_response = _as_mapping(
                self._invoke("save_document", save_arguments), "save_document"
            )
            if save_response.get("success") is not True:
                raise DataHubWriteBackError("save_document did not succeed")
            document_urn = save_response.get("urn")
            if not isinstance(document_urn, str) or not document_urn.startswith("urn:li:"):
                raise DataHubWriteBackError("save_document omitted its document URN")
            document_saved = True

            tagged_urns: tuple[str, ...] = ()
            if report.decision.blocks_merge:
                if tag_urn is None:
                    raise DataHubWriteBackError("blocking report omitted its risk tag")
                tag_response = _as_mapping(
                    self._invoke(
                        "add_tags",
                        {"tag_urns": [tag_urn], "entity_urns": target_urns},
                    ),
                    "add_tags",
                )
                if tag_response.get("success") is not True:
                    raise DataHubWriteBackError(
                        "add_tags did not succeed",
                        document_saved=True,
                        document_urn=document_urn,
                    )
                tagged_urns = tuple(target_urns)
                tags_applied = True
        except DataHubWriteBackError:
            raise
        except DataHubContextError as error:
            raise DataHubWriteBackError(
                "DataHub write-back operation failed",
                document_saved=document_saved,
                document_urn=document_urn,
                tags_applied=tags_applied,
            ) from error

        return WriteBackResult(
            success=True,
            document_urn=document_urn,
            tagged_urns=tagged_urns,
            updated_existing_document=existing_document is not None,
        )
