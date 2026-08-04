# Cutset architecture

Cutset is a narrow PR safety agent: it accepts one dbt column rename, grounds the impact in DataHub, and produces a deterministic merge verdict plus a reviewable compatibility patch.

```text
Git base/head
    │
    ▼
dbt diff parser ── unsupported/ambiguous ──► exit 2
    │
    ▼
DataHub search → entity confirmation → schema → column lineage
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
- Merge safety is pure policy code. A model may draft remediation, but cannot choose the verdict.
- Generated SQL is limited to one compatibility alias over verified columns. Cutset emits it for review and never applies it.
- Write-back targets are derived only from the current evidence graph. The report is written locally before any mutation.

## DataHub capabilities used

- `search` resolves the changed dbt model and the configured risk tag.
- `get_entities` confirms the resolved source asset.
- `list_schema_fields` verifies the old column.
- `get_lineage` traces downstream column consumers through three hops.
- `search_documents` finds an existing analysis by stable key.
- `save_document` creates or updates the impact analysis.
- `add_tags` marks the affected assets with an existing catalog tag.
