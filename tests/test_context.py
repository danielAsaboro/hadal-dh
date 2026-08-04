import pytest

from cutset.context import (
    ContextNormalizationError,
    normalize_assertions,
    normalize_entity_context,
    normalize_queries,
)
from cutset.domain import AssetRef


DATASET = AssetRef("urn:li:dataset:customers", "dataset", "customers")


def test_normalizes_entity_governance_and_health() -> None:
    contexts = normalize_entity_context(
        (DATASET,),
        [
            {
                "urn": DATASET.urn,
                "ownership": {
                    "owners": [
                        {
                            "owner": {
                                "urn": "urn:li:corpuser:alice",
                                "properties": {"displayName": "Alice"},
                            }
                        }
                    ]
                },
                "tags": {
                    "tags": [
                        {
                            "tag": {
                                "urn": "urn:li:tag:customer-data",
                                "properties": {"name": "Customer Data"},
                            }
                        }
                    ]
                },
                "glossaryTerms": {
                    "terms": [
                        {
                            "term": {
                                "urn": "urn:li:glossaryTerm:customer-identity",
                                "properties": {"name": "Customer Identity"},
                            }
                        }
                    ]
                },
                "health": [
                    {"type": "INCIDENTS", "status": "PASS"},
                    {"type": "ASSERTIONS", "status": "FAIL"},
                ],
            }
        ],
    )

    assert contexts[0].owners[0].name == "Alice"
    assert contexts[0].tags[0].urn == "urn:li:tag:customer-data"
    assert contexts[0].glossary_terms[0].name == "Customer Identity"
    assert contexts[0].incident_statuses == ("FAIL", "PASS")
    assert contexts[0].complete is True


def test_normalizes_and_redacts_query_literals() -> None:
    total, queries = normalize_queries(
        DATASET,
        {
            "total": 1,
            "start": 0,
            "count": 10,
            "queries": [
                {
                    "urn": "urn:li:query:q1",
                    "properties": {
                        "statement": {
                            "value": (
                                "select email from analytics.customers "
                                "where region = 'NG' and score > 10"
                            ),
                            "language": "SQL",
                        },
                        "source": "SYSTEM",
                        "name": "customer export",
                    },
                    "subjects": [DATASET.urn],
                }
            ],
        },
    )

    assert total == 1
    assert "NG" not in queries[0].statement
    assert "10" not in queries[0].statement
    assert "analytics.customers" in queries[0].statement
    assert queries[0].subjects == (DATASET.urn,)


def test_accepts_real_empty_query_page_shape() -> None:
    total, queries = normalize_queries(
        DATASET,
        {"start": 0, "total": 0, "count": 10},
    )

    assert total == 0
    assert queries == ()


def test_entity_omission_and_nonempty_query_page_without_results_fail_closed() -> None:
    with pytest.raises(ContextNormalizationError, match="requested URNs"):
        normalize_entity_context((DATASET,), [])

    with pytest.raises(ContextNormalizationError, match="queries"):
        normalize_queries(
            DATASET,
            {"total": 2, "start": 0, "count": 10},
        )


def test_normalizes_assertion_totals_and_sample() -> None:
    sample = {
        "success": True,
        "data": {
            "start": 0,
            "count": 1,
            "total": 3,
            "assertions": [
                {
                    "urn": "urn:li:assertion:email-not-null",
                    "type": "FIELD",
                    "column": "email",
                    "latestResultType": "FAILING",
                }
            ],
        },
    }
    failing = {
        "success": True,
        "data": {"start": 0, "count": 1, "total": 1, "assertions": [{}]},
    }
    errors = {
        "success": True,
        "data": {"start": 0, "count": 0, "total": 0, "assertions": []},
    }

    summary = normalize_assertions(sample, failing, errors)

    assert summary.total == 3
    assert summary.failing == 1
    assert summary.errors == 0
    assert summary.sample[0].status == "FAILING"


def test_rejects_unsuccessful_or_malformed_assertion_pages() -> None:
    empty = {
        "success": True,
        "data": {"start": 0, "count": 0, "total": 0, "assertions": []},
    }

    with pytest.raises(ContextNormalizationError, match="did not succeed"):
        normalize_assertions({"success": False}, empty, empty)

    malformed = {
        "success": True,
        "data": {"start": 0, "count": 1, "total": 1, "assertions": []},
    }
    with pytest.raises(ContextNormalizationError, match="count"):
        normalize_assertions(malformed, empty, empty)
