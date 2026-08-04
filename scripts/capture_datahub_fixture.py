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
    transcript = {
        "search": search,
        "get_entities": gateway._invoke("get_entities", {"urns": [urn]}),
        "list_schema_fields": gateway._invoke(
            "list_schema_fields",
            {"urn": urn, "keywords": [args.column], "limit": 100, "offset": 0},
        ),
        "get_lineage": gateway._invoke(
            "get_lineage",
            {
                "urn": urn,
                "column": args.column,
                "upstream": False,
                "max_hops": 3,
                "max_results": 50,
                "offset": 0,
            },
        ),
    }
    print(json.dumps(transcript, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
