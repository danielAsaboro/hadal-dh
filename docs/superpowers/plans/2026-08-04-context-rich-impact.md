# Context-Rich Impact Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich Cutset's verified lineage with real DataHub governance, quality, and usage context; deterministically rank affected assets; and ground compatibility SQL in observed, literal-redacted queries.

**Architecture:** Keep `DataHubGateway` responsible for tool orchestration, move pure response normalization into `context.py`, and keep ranking in `ranking.py`. Extend immutable domain records so policy, remediation, reporting, and write-back consume one canonical evidence bundle without making their own network calls.

**Tech Stack:** Python 3.11–3.13, DataHub Agent Context Kit 1.6.x, `sqlglot`, `pytest`, Typer, DataHub OSS/Core v1.6.0.

## Global Constraints

- Continue supporting exactly one unambiguous dbt column rename.
- Use only URNs returned and confirmed by DataHub; never guess governance URNs.
- Empty optional metadata is valid, but missing tools, failed calls, malformed responses, and unverified counts fail closed.
- Raw SQL query text must never enter a report, prompt, log, or DataHub document; parse it and redact literals first.
- Ranking explains urgency but does not replace the deterministic structural merge policy.
- Generated SQL remains one read-only compatibility alias and is never applied automatically.
- No publishing or GitHub remote operations are part of this plan.

---

### Task 1: Immutable Context Model and Response Normalization

**Files:**
- Modify: `pyproject.toml`
- Modify: `src/cutset/domain.py`
- Create: `src/cutset/context.py`
- Create: `tests/test_context.py`

**Interfaces:**
- Produces: `UsageQuery`, `AssertionSignal`, `QualitySummary`, `AssetContext`, and `ImpactEvidence.asset_contexts`.
- Produces: `normalize_entity_context(assets, response)`, `normalize_queries(dataset, response)`, and `normalize_assertions(sample_response, failing_response, error_response)`.
- Consumes: existing `AssetRef`, `ImpactEvidence`, and DataHub Agent Context response dictionaries.

- [ ] **Step 1: Add failing normalization tests**

```python
def test_normalizes_and_redacts_query_literals() -> None:
    dataset = AssetRef("urn:li:dataset:customers", "dataset", "customers")
    total, queries = normalize_queries(dataset, {
        "total": 1,
        "start": 0,
        "count": 1,
        "queries": [{
            "urn": "urn:li:query:q1",
            "properties": {
                "statement": {"value": "select email from analytics.customers where region = 'NG' and score > 10", "language": "SQL"},
                "source": "SYSTEM",
                "name": "customer export",
            },
            "subjects": [dataset.urn],
        }],
    })
    assert total == 1
    assert "NG" not in queries[0].statement
    assert "10" not in queries[0].statement
    assert "analytics.customers" in queries[0].statement


def test_entity_omission_and_query_count_mismatch_fail_closed() -> None:
    asset = AssetRef("urn:li:dataset:customers", "dataset", "customers")
    with pytest.raises(ContextNormalizationError, match="requested URNs"):
        normalize_entity_context((asset,), [])
    with pytest.raises(ContextNormalizationError, match="count"):
        normalize_queries(asset, {"total": 2, "start": 0, "count": 2, "queries": []})
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `.venv/bin/pytest -q tests/test_context.py`

Expected: collection fails because `cutset.context` and the new records do not exist.

- [ ] **Step 3: Add `sqlglot` and implement normalized records**

Add `"sqlglot>=26,<28"` to project dependencies. Define frozen slot dataclasses in `domain.py`:

```python
@dataclass(frozen=True, slots=True)
class UsageQuery:
    urn: str
    source: str
    language: str
    name: str | None
    statement: str
    subjects: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AssertionSignal:
    urn: str
    assertion_type: str
    column: str | None
    status: str


@dataclass(frozen=True, slots=True)
class QualitySummary:
    total: int = 0
    failing: int = 0
    errors: int = 0
    sample: tuple[AssertionSignal, ...] = ()


@dataclass(frozen=True, slots=True)
class AssetContext:
    asset: AssetRef
    owners: tuple[AssetRef, ...] = ()
    tags: tuple[AssetRef, ...] = ()
    glossary_terms: tuple[AssetRef, ...] = ()
    incident_statuses: tuple[str, ...] = ()
    query_total: int = 0
    queries: tuple[UsageQuery, ...] = ()
    quality: QualitySummary = QualitySummary()
    complete: bool = True
```

Add `asset_contexts: tuple[AssetContext, ...] = ()` to `ImpactEvidence`.

In `context.py`, parse SQL with `sqlglot.parse_one`, replace every `exp.Literal` with `exp.Placeholder()`, render at most 2,000 characters, require exact requested URN coverage, and require `count == len(results)`, `start == 0`, and `total >= count` for bounded result pages. Raise `ContextNormalizationError` on malformed data.

- [ ] **Step 4: Run normalization and regression tests**

Run: `.venv/bin/pytest -q tests/test_context.py tests/test_datahub_normalization.py tests/test_policy.py`

Expected: all selected tests pass.

- [ ] **Step 5: Commit the context model**

```bash
git add pyproject.toml src/cutset/domain.py src/cutset/context.py tests/test_context.py
git commit -m "feat: normalize DataHub asset context"
```

---

### Task 2: Fail-Closed Enriched DataHub Reads

**Files:**
- Modify: `src/cutset/datahub_gateway.py`
- Modify: `tests/test_datahub_normalization.py`
- Modify: `tests/integration/test_datahub_gateway.py`

**Interfaces:**
- Consumes: Task 1 normalization functions and domain records.
- Produces: `DataHubGateway.collect_evidence()` with complete `asset_contexts` for the source and each unique downstream target.

- [ ] **Step 1: Add failing gateway orchestration tests**

Extend the fake gateway with `get_dataset_queries` and `get_dataset_assertions`. Assert these exact calls for the source dataset:

```python
assert gateway.tools["get_dataset_queries"].calls == [{
    "urn": source_urn,
    "column": "email",
    "start": 0,
    "count": 10,
}]
assert gateway.tools["get_dataset_assertions"].calls[:3] == [
    {"urn": source_urn, "start": 0, "count": 5, "column": "email", "run_events_count": 1},
    {"urn": source_urn, "start": 0, "count": 1, "column": "email", "status": "FAILING", "run_events_count": 1},
    {"urn": source_urn, "start": 0, "count": 1, "column": "email", "status": "ERROR", "run_events_count": 1},
]
```

Add tests proving a missing context tool, omitted entity, malformed query page, or malformed assertion page returns `ImpactEvidence.complete is False` without fabricating empty metadata.

- [ ] **Step 2: Run the gateway tests and confirm failure**

Run: `.venv/bin/pytest -q tests/test_datahub_normalization.py`

Expected: failures show that enrichment tools are not invoked and `asset_contexts` is empty.

- [ ] **Step 3: Implement enrichment orchestration**

Add a private gateway method with this interface:

```python
def _collect_asset_contexts(
    self,
    source: AssetRef,
    paths: tuple[LineagePath, ...],
    change: ColumnRename,
) -> tuple[tuple[AssetContext, ...], bool]:
```

Deduplicate the source and downstream targets by URN. Fetch all entity records in one call. For each dataset, derive relevant columns from the source rename or `downstream_columns`, then fetch ten queries plus the three assertion views. Catch `DataHubContextError` and `ContextNormalizationError`; preserve the verified asset identity in an `AssetContext(complete=False)` without representing unknown metadata as verified empty metadata. Append the normalized contexts to `ImpactEvidence` and combine their completeness with schema and lineage completeness.

- [ ] **Step 4: Run gateway and CLI regression tests**

Run: `.venv/bin/pytest -q tests/test_datahub_normalization.py tests/test_cli.py tests/integration/test_datahub_gateway.py`

Expected: unit tests pass; live tests skip when integration variables are absent.

- [ ] **Step 5: Commit enriched reads**

```bash
git add src/cutset/datahub_gateway.py tests/test_datahub_normalization.py tests/integration/test_datahub_gateway.py
git commit -m "feat: collect governance quality and usage context"
```

---

### Task 3: Deterministic Impact Ranking

**Files:**
- Modify: `src/cutset/domain.py`
- Create: `src/cutset/ranking.py`
- Create: `tests/test_ranking.py`
- Modify: `src/cutset/application.py`
- Modify: `src/cutset/reporting.py`
- Modify: `tests/test_reporting.py`

**Interfaces:**
- Produces: `RankedImpact(asset, score, factors)` and `rank_impacts(evidence) -> tuple[RankedImpact, ...]`.
- Consumes: `ImpactEvidence.asset_contexts` and lineage paths.
- Extends: `ImpactReport.ranked_impacts`.

- [ ] **Step 1: Write failing score and tie-break tests**

```python
def test_ml_quality_usage_and_missing_owner_factors_are_additive() -> None:
    ranked = rank_impacts(evidence_with_ml_context(
        failing=1, errors=0, incident_statuses=("FAIL",), system_queries=2,
        query_total=25, owners=(),
    ))
    assert ranked[0].score == 230
    assert ranked[0].factors == (
        "ml_asset", "column_mapping", "quality_failure", "incident_failure",
        "production_usage", "usage_volume", "missing_owner",
    )


def test_equal_scores_sort_by_urn() -> None:
    ranked = rank_impacts(two_equal_dataset_impacts())
    assert [item.asset.urn for item in ranked] == sorted(item.asset.urn for item in ranked)
```

The score is `100 + 40 + 30 + 25 + 20 + min(25, 10) + 5 = 230`; use that exact expected value in the committed test.

- [ ] **Step 2: Run ranking tests and confirm failure**

Run: `.venv/bin/pytest -q tests/test_ranking.py`

Expected: collection fails because `cutset.ranking` does not exist.

- [ ] **Step 3: Implement ranking and report integration**

Define:

```python
@dataclass(frozen=True, slots=True)
class RankedImpact:
    asset: AssetRef
    score: int
    factors: tuple[str, ...]
```

Implement the exact weights from the design. `usage_volume` contributes `min(query_total, 10)`. Detect production usage from `UsageQuery.source == "SYSTEM"`; detect incident failure from statuses `FAIL`, `FAILING`, or `ERROR`. Build `ImpactReport.ranked_impacts` in `analyze()` after the deterministic decision.

Render ranked impacts in JSON and a Markdown `## Ranked impact` section. Do not change `decide()` or existing exit codes.

- [ ] **Step 4: Run ranking, policy, application, and reporting tests**

Run: `.venv/bin/pytest -q tests/test_ranking.py tests/test_policy.py tests/test_reporting.py tests/test_cli.py`

Expected: all selected tests pass and existing policy expectations remain unchanged.

- [ ] **Step 5: Commit ranking**

```bash
git add src/cutset/domain.py src/cutset/ranking.py src/cutset/application.py src/cutset/reporting.py tests/test_ranking.py tests/test_reporting.py
git commit -m "feat: rank downstream impact deterministically"
```

---

### Task 4: Query-Grounded Compatibility Remediation

**Files:**
- Modify: `src/cutset/remediation.py`
- Modify: `src/cutset/application.py`
- Modify: `tests/test_remediation.py`
- Modify: `tests/test_reporting.py`

**Interfaces:**
- Produces: `select_remediation_grounding(evidence) -> RemediationGrounding`.
- Extends: `RemediationDraft.grounding_mode` and `RemediationDraft.supporting_query_urn`.
- Consumes: normalized, literal-redacted `UsageQuery` records from Task 1.

- [ ] **Step 1: Add failing grounding tests**

```python
def test_prefers_observed_query_relation_and_cites_query() -> None:
    grounding = select_remediation_grounding(evidence_with_query(
        "urn:li:query:q1",
        "SELECT email FROM analytics.customers WHERE region = ?",
    ))
    assert grounding.mode == "query_grounded"
    assert grounding.relation == "analytics.customers"
    assert grounding.query_urn == "urn:li:query:q1"


def test_ambiguous_query_falls_back_to_verified_dataset_name() -> None:
    grounding = select_remediation_grounding(evidence_with_query(
        "urn:li:query:q2",
        "SELECT a.email FROM analytics.customers a JOIN crm.contacts c ON a.email = c.email",
    ))
    assert grounding.mode == "schema_grounded"
    assert grounding.relation == "analytics.customers"
    assert grounding.query_urn is None
```

Add validation tests proving that a `query_grounded` draft is invalid when its relation or cited query URN does not match normalized evidence.

- [ ] **Step 2: Run remediation tests and confirm failure**

Run: `.venv/bin/pytest -q tests/test_remediation.py`

Expected: failures show the grounding selector and fields are absent.

- [ ] **Step 3: Implement selection and validation**

Define:

```python
@dataclass(frozen=True, slots=True)
class RemediationGrounding:
    mode: str
    relation: str
    query_urn: str | None
```

Use `sqlglot.parse_one` on already normalized statements. A query is usable only when it contains the old column and exactly one table relation. Select candidates deterministically by `SYSTEM` before `MANUAL`, then query URN. Parse the verified dataset name with `DatasetUrn.from_string(evidence.source.urn).name` for fallback.

Extend `RemediationDraft` with defaulted grounding fields to preserve existing construction. Update deterministic generation and model prompts to use the selected relation. Validation re-parses the cited normalized query and requires the alias source, target, relation, and supporting query URN to agree with the evidence.

- [ ] **Step 4: Run remediation and report regression tests**

Run: `.venv/bin/pytest -q tests/test_remediation.py tests/test_reporting.py tests/test_cli.py`

Expected: all selected tests pass; generated SQL uses `analytics.customers` instead of `upstream` in enriched evidence.

- [ ] **Step 5: Commit grounded remediation**

```bash
git add src/cutset/remediation.py src/cutset/application.py tests/test_remediation.py tests/test_reporting.py
git commit -m "feat: ground remediation in observed DataHub SQL"
```

---

### Task 5: Live Context Seed, Write-Back Proof, and Documentation

**Files:**
- Modify: `src/cutset/demo_seed.py`
- Modify: `tests/test_seed_demo_datahub.py`
- Modify: `tests/integration/test_datahub_gateway.py`
- Modify: `examples/impact-report.json`
- Modify: `examples/impact-report.md`
- Modify: `examples/sample-run.md`
- Modify: `docs/architecture.md`
- Modify: `docs/verification.md`
- Modify outside public repo: `/Volumes/Development/wip/datahub/submission/evidence/live-datahub-proof-2026-08-04.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a reproducible DataHub v1.6.0 seed with a real query and judge-readable enriched live output.

- [ ] **Step 1: Add failing seed and live assertions**

Extend the seed test to require a `customer-data` tag, a `Customer Identity` glossary term, an owner on `analytics.customers`, and a query MCP with:

```python
QueryPropertiesClass(
    statement=QueryStatementClass(
        value="select customer_id, email from analytics.customers where region = 'NG'",
        language=QueryLanguageClass.SQL,
    ),
    source=QuerySourceClass.SYSTEM,
    name="Customer feature extraction",
    created=audit_stamp,
    lastModified=audit_stamp,
)
```

and a `QuerySubjectsClass` containing the exact customers dataset URN. Strengthen the live test to assert a nonzero query total, redacted literals, `churn_prediction_v2` ranked first, `query_grounded` remediation, and idempotent enriched write-back.

- [ ] **Step 2: Run seed and live tests to confirm the missing metadata**

Run: `.venv/bin/pytest -q tests/test_seed_demo_datahub.py`

Expected: failure because the seed does not emit a query.

- [ ] **Step 3: Emit supported query metadata and refresh docs**

Create `Tag(name="customer-data")`, `GlossaryNode(id="cutset-demo", display_name="Cutset Demo")`, and `GlossaryTerm(id="customer-identity", display_name="Customer Identity", parent_node=node)`, then attach their SDK objects plus owner `cutset-demo` to the source dataset. Use `QueryUrn(id="cutset-customer-feature-extraction")` plus `MetadataChangeProposalWrapper` to upsert `QueryPropertiesClass` and `QuerySubjectsClass`. Use an `AuditStampClass` with actor `urn:li:corpuser:cutset-demo` and the current seed timestamp. Keep assertions at their real explicit zero state unless a supported v1.6.0 assertion contract is added and verified.

Run the seed, live CLI twice, and copy the exact generated JSON/Markdown into `examples/` using patch-based edits. Update architecture and verification text to describe the new reads, ranking, grounding, and proof without claiming unavailable assertion data.

- [ ] **Step 4: Run complete verification**

Run:

```bash
.venv/bin/pytest -q
DATAHUB_GMS_URL=http://localhost:8080 \
CUTSET_INTEGRATION_DATASET='urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)' \
CUTSET_INTEGRATION_COLUMN=email \
CUTSET_INTEGRATION_WRITEBACK=1 \
CUTSET_RISK_TAG=cutset-at-risk \
.venv/bin/pytest -q tests/integration/test_datahub_gateway.py
.venv/bin/python -m pip wheel . --no-deps --no-build-isolation -w /tmp/cutset-context-wheel
.venv/bin/python -m cutset.cli --help
git diff --check
```

Expected: all unit and live tests pass, a wheel is produced, CLI help exits zero, and `git diff --check` emits no output.

- [ ] **Step 5: Request independent review and commit the proof**

Review must check fail-closed pagination, SQL redaction, ranking/policy separation, exact example parity, and mutation guards. Address all Critical and Important findings, rerun Step 4, then commit:

```bash
git add src/cutset/demo_seed.py tests/test_seed_demo_datahub.py tests/integration/test_datahub_gateway.py examples docs
git commit -m "feat: prove context-rich impact analysis"
```
