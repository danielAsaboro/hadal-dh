import json
from pathlib import Path

import pytest

from cutset.datahub_gateway import (
    DataHubContextError,
    DataHubGateway,
    normalize_lineage,
)
from cutset.domain import AssetRef, ColumnRename


def _captured_lineage() -> dict:
    return json.loads(
        Path("tests/fixtures/datahub/lineage_customer_email.json").read_text()
    )


def _exact_path() -> dict:
    return json.loads(
        Path("tests/fixtures/datahub/exact_lineage_path.json").read_text()
    )


def test_normalizes_lineage_paths_from_sanitized_response() -> None:
    source = AssetRef(
        urn="urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)",
        asset_type="dataset",
        name="analytics.customers",
    )

    paths, complete = normalize_lineage(source, "email", _captured_lineage())

    assert complete is True
    assert paths[0].source.urn.startswith("urn:li:dataset:")
    assert any(path.downstream.asset_type == "mlModel" for path in paths)
    assert paths[0].degree == "1"
    assert paths[0].downstream_columns == ("email_hash",)
    assert [path.downstream.name for path in paths] == [
        "analytics.customer_features",
        "customer_email_domain",
        "churn_prediction_v2",
    ]


def test_marks_paginated_lineage_incomplete() -> None:
    source = AssetRef("urn:li:dataset:source", "dataset", "customers")
    response = _captured_lineage()
    response["downstreams"]["hasMore"] = True

    _, complete = normalize_lineage(source, "email", response)

    assert complete is False


def test_marks_token_truncation_incomplete() -> None:
    source = AssetRef("urn:li:dataset:source", "dataset", "customers")
    response = _captured_lineage()
    response["downstreams"]["truncatedDueToTokenBudget"] = True

    _, complete = normalize_lineage(source, "email", response)

    assert complete is False


def test_marks_missing_lineage_metadata_incomplete() -> None:
    source = AssetRef("urn:li:dataset:source", "dataset", "customers")

    paths, complete = normalize_lineage(source, "email", {})

    assert paths == ()
    assert complete is False


def test_accepts_explicitly_complete_empty_lineage() -> None:
    source = AssetRef("urn:li:dataset:source", "dataset", "customers")
    response = {
        "downstreams": {
            "searchResults": [],
            "start": 0,
            "count": 0,
            "total": 0,
        }
    }

    paths, complete = normalize_lineage(source, "email", response)

    assert paths == ()
    assert complete is True


class _FakeTool:
    def __init__(self, name: str, response: object) -> None:
        self.name = name
        self.response = response
        self.calls: list[dict] = []

    def invoke(self, arguments: dict) -> object:
        self.calls.append(arguments)
        if callable(self.response):
            return self.response(arguments)
        return self.response


def _exact_path_for(arguments: dict) -> dict:
    response = _exact_path()
    target_urn = arguments["target_urn"]
    response["target"]["urn"] = target_urn
    if arguments.get("target_column") is None:
        response["metadata"]["pathType"] = "dataset-level"
        response["source"].pop("column", None)
        response["target"].pop("column", None)
    response["paths"][0]["path"][-1]["urn"] = target_urn
    return response


def _gateway(*, search_results: int = 1, remaining_fields: int = 0) -> DataHubGateway:
    source_urn = (
        "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)"
    )
    entity = {
        "urn": source_urn,
        "type": "DATASET",
        "properties": {"name": "analytics.customers"},
    }
    search_entities = [entity]
    if search_results > 1:
        search_entities.extend(
            {
                **entity,
                "urn": f"urn:li:dataset:(urn:li:dataPlatform:bigquery,analytics.customers_{index},PROD)",
                "properties": {"name": "analytics.customers"},
            }
            for index in range(1, search_results)
        )
    tools = [
        _FakeTool(
            "search",
            {
                "searchResults": [
                    {"entity": search_entity} for search_entity in search_entities
                ],
                "total": search_results,
            },
        ),
        _FakeTool("get_entities", [entity]),
        _FakeTool(
            "list_schema_fields",
            {
                "urn": source_urn,
                "fields": [{"fieldPath": "email"}],
                "remainingCount": remaining_fields,
            },
        ),
        _FakeTool("get_lineage", _captured_lineage()),
        _FakeTool("get_lineage_paths_between", _exact_path_for),
    ]
    return DataHubGateway(client=object(), tools=tools)


def test_collects_grounded_evidence_using_resolved_urn() -> None:
    gateway = _gateway()
    change = ColumnRename("customers", "email", "email_address", "models/customers.yml")

    evidence = gateway.collect_evidence(change)

    assert evidence.source.urn.startswith("urn:li:dataset:")
    assert evidence.complete is True
    assert any(path.downstream.asset_type == "mlModel" for path in evidence.lineage_paths)
    assert any(
        node.asset_type == "query"
        for path in evidence.lineage_paths
        for node in path.nodes
    )
    assert gateway.tools["get_lineage"].calls == [
        {
            "urn": evidence.source.urn,
            "column": "email",
            "upstream": False,
            "max_hops": 3,
            "max_results": 50,
            "offset": 0,
        }
    ]


def test_rejects_ambiguous_asset_resolution() -> None:
    gateway = _gateway(search_results=2)
    change = ColumnRename("customers", "email", "email_address", "models/customers.yml")

    with pytest.raises(DataHubContextError, match="exactly one"):
        gateway.collect_evidence(change)


def test_rejects_incomplete_asset_search() -> None:
    gateway = _gateway()
    gateway.tools["search"].response["total"] = 11
    change = ColumnRename("customers", "email", "email_address", "models/customers.yml")

    with pytest.raises(DataHubContextError, match="incomplete"):
        gateway.collect_evidence(change)


def test_marks_truncated_schema_context_incomplete() -> None:
    gateway = _gateway(remaining_fields=1)
    change = ColumnRename("customers", "email", "email_address", "models/customers.yml")

    evidence = gateway.collect_evidence(change)

    assert evidence.complete is False
