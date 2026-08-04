"""Print raw read-tool responses for private evidence capture and sanitization."""

import argparse
import json

from cutset.datahub_gateway import DataHubContextError, DataHubGateway


def _entity(result: object) -> dict:
    if not isinstance(result, dict):
        raise DataHubContextError("search returned an unexpected response")
    matches = result.get("searchResults", [])
    if not isinstance(matches, list) or len(matches) != 1:
        raise DataHubContextError("capture requires exactly one search result")
    entity = matches[0].get("entity")
    if not isinstance(entity, dict) or not isinstance(entity.get("urn"), str):
        raise DataHubContextError("search result omitted its URN")
    return entity


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--column", required=True)
    args = parser.parse_args()
    gateway = DataHubGateway.from_env()

    search = gateway._invoke(
        "search",
        {
            "query": f"/q {args.model}",
            "filter": "entity_type = dataset",
            "num_results": 10,
            "offset": 0,
        },
    )
    urn = _entity(search)["urn"]
    lineage = gateway._invoke(
        "get_lineage",
        {
            "urn": urn,
            "column": args.column,
            "upstream": False,
            "max_hops": 3,
            "max_results": 50,
            "offset": 0,
        },
    )
    exact_paths = []
    if isinstance(lineage, dict):
        downstreams = lineage.get("downstreams", {})
        results = downstreams.get("searchResults", []) if isinstance(downstreams, dict) else []
        for result in results if isinstance(results, list) else []:
            entity = result.get("entity", {}) if isinstance(result, dict) else {}
            target_urn = entity.get("urn") if isinstance(entity, dict) else None
            columns = result.get("lineageColumns", []) if isinstance(result, dict) else []
            if not isinstance(target_urn, str):
                continue
            for target_column in columns or [None]:
                path_args = {
                    "source_urn": urn,
                    "target_urn": target_urn,
                    "direction": "downstream",
                }
                if isinstance(target_column, str):
                    path_args["source_column"] = args.column
                    path_args["target_column"] = target_column
                exact_paths.append(
                    gateway._invoke("get_lineage_paths_between", path_args)
                )

    transcript = {
        "search": search,
        "get_entities": gateway._invoke("get_entities", {"urns": [urn]}),
        "list_schema_fields": gateway._invoke(
            "list_schema_fields",
            {"urn": urn, "keywords": [args.column], "limit": 100, "offset": 0},
        ),
        "get_lineage": lineage,
        "get_lineage_paths_between": exact_paths,
    }
    print(json.dumps(transcript, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
