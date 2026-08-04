# Cutset architecture

Cutset is a narrow PR safety agent: it accepts one dbt column rename, grounds the impact in DataHub, and produces a deterministic merge verdict plus a reviewable compatibility patch.

```text
Git base/head
    │
    ▼
dbt diff parser ── unsupported/ambiguous ──► exit 2
    │
    ▼
DataHub search → schema → lineage → exact paths → governance/usage/quality
    │                                      │
    │                         incomplete ──► exit 3
    ▼
normalized immutable evidence
    │
    ├─ deterministic safety policy
    │      └─ unsafe impact ───────────────► exit 4
    │
    ├─ constrained remediation + validator ─► exit 5 if invalid
    │
    ├─ JSON / Markdown reports
    │
    └─ optional DataHub document + tag ─────► exit 6 on write failure
```

## Trust boundaries

- Git revisions are validated before `git diff` runs.
- Dataset and tag URNs are retained from DataHub search results; Cutset never constructs them.
- Pagination and token truncation make evidence incomplete and therefore blocking.
- Query SQL comments are removed and literals are replaced with placeholders before entering evidence or reports.
- Merge safety is pure policy code. A model may draft remediation, but cannot choose the verdict.
- Impact ranking is deterministic and advisory; it never changes the merge verdict.
- Generated SQL is limited to one compatibility alias over a relation verified from a DataHub query or dataset URN. Cutset emits it for review and never applies it.
- Write-back targets are derived only from the current evidence graph. The report is written locally before any mutation.

## DataHub capabilities used

- `search` resolves the changed dbt model and the configured risk tag.
- `get_entities` confirms every relevant asset and normalizes ownership, tags, glossary terms, and health.
- `list_schema_fields` verifies the old column.
- `get_lineage` traces downstream column consumers through three hops.
- `get_lineage_paths_between` preserves intermediate assets, queries, and columns for audit.
- `get_dataset_queries` supplies bounded, literal-redacted usage evidence and remediation grounding.
- `get_dataset_assertions` supplies bounded quality totals and samples.
- `search_documents` finds an existing analysis by stable key.
- `save_document` creates or updates the impact analysis.
- `add_tags` marks the affected assets with an existing catalog tag.

The GitHub workflow runs on `pull_request_target`, installs Cutset only from the trusted base commit, and checks out the PR head into a separate directory treated strictly as Git diff data. DataHub secrets are additionally gated by the protected `datahub-review` environment; candidate code is never imported or executed.
