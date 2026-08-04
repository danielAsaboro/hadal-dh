# Context-Rich Impact Analysis Design

## Purpose

Cutset currently proves that a renamed dbt column reaches downstream datasets
and ML assets. The next slice answers the more useful question: **which affected
assets matter most, why do they matter, and what compatibility code matches the
way the organization actually queries the data?**

This improvement enriches verified lineage with ownership, tags, glossary
terms, incidents, data-quality assertions, and observed SQL usage from DataHub.
The enriched context explains and ranks impact; deterministic code still owns
the merge verdict and validation.

## Alternatives Considered

### Enrich context before broadening change support — selected

Keep the one-column-rename boundary and make its result materially better. This
uses more of DataHub's graph, strengthens the remediation, and preserves the
already proven Git-to-DataHub flow.

### Add more schema-change types first

Supporting deletion and type changes would widen coverage, but every result
would still be a shallow lineage report. This is deferred until the evidence
model is strong enough to support those changes safely.

### Prioritize GitHub presentation first

Inline comments and richer checks improve ergonomics but do not improve the
quality of the agent's decision. The existing workflow summary remains enough
to demonstrate the enriched engine.

## Scope

For the resolved source dataset and every affected downstream dataset or ML
asset, Cutset will retrieve the context that DataHub exposes through the
installed Agent Context Kit:

- `get_entities` for owners, tags, glossary terms, descriptions, and incident
  health;
- `get_dataset_queries` for bounded, column-relevant SQL usage and total usage
  counts;
- `get_dataset_assertions` for assertion totals and active failing/error counts.

Queries and assertions apply only to datasets. A missing owner, zero queries,
zero assertions, or no glossary term is valid metadata absence. A malformed
response, failed request, mismatched URN, or pagination state that prevents a
claimed count from being verified makes the enriched evidence incomplete.

This slice does not add a dashboard, execute generated SQL, modify a pull
request, support another diff type, or make an LLM responsible for merge
safety.

## Evidence Model

`ImpactEvidence` gains a context record for each distinct affected asset.
Normalized records are immutable and contain only bounded, report-safe data:

- owner URNs and display names;
- tag URNs and names;
- glossary-term URNs and names;
- incident health status;
- assertion totals plus failing/error totals;
- usage-query total and up to ten query examples;
- query URN, source (`MANUAL` or `SYSTEM`), language, name, and normalized SQL
  statement with literal values redacted;
- completeness for the asset context.

The report retains normalized query structure because it is the evidence used
for code generation. Cutset will parse each statement, replace string and
numeric literals with placeholders, cap the rendered statement's length, and
reject non-string or malformed statements. Raw query text never enters a report,
prompt, log, or write-back document.
The JSON report remains the canonical machine-readable artifact.

Context is keyed by exact DataHub URN. Duplicate assets reached by multiple
paths share one context record. All returned entity and query subjects must be
DataHub URNs; Cutset does not construct governance URNs.

## Retrieval Flow

1. Resolve and verify the source, schema, column lineage, and exact paths using
   the existing fail-closed flow.
2. Build the distinct asset set from the source and exact lineage targets.
3. Retrieve entity context in one `get_entities` call and verify one response
   for every requested URN.
4. For each dataset, retrieve at most ten relevant queries. Use the renamed
   source column for the source dataset and mapped downstream columns where
   available. Record the server-reported total separately from the examples.
5. For each dataset, query assertions twice: a bounded display sample and a
   count filtered to `FAILING`, then a count filtered to `ERROR`. The filtered
   totals prevent a healthy-looking first page from hiding active failures.
6. Normalize the results, compute deterministic rankings, and only then create
   the decision and remediation.

The gateway may make these reads sequentially in the first implementation. The
asset count is bounded by the existing three-hop and fifty-result lineage
limits, and clarity is more valuable than premature concurrency.

## Deterministic Ranking

Ranking explains urgency without replacing the existing safety verdict. Each
affected target receives a score and stable factor codes:

- `100` for an ML model or ML feature;
- `40` for a verified downstream column mapping;
- `30` when a failing or error assertion exists;
- `25` when DataHub reports failing incident health;
- `20` when at least one `SYSTEM` query exists;
- up to `10` from the verified total usage count;
- `5` when no owner is assigned.

Scores sort descending, then by URN for deterministic ties. The report shows
the score and factors, but the merge verdict remains:

- incomplete required evidence: blocked/context incomplete;
- affected ML asset: critical/block;
- other downstream column consumer: high/block;
- no downstream consumer: info/pass.

This separation prevents popularity, ownership hygiene, or an intermittent
quality failure from silently changing a structural compatibility policy.

## SQL-Grounded Remediation

The generator receives only normalized evidence. It prefers a verified query
that references the old column and extracts the real source relation from that
SQL. The compatibility alias becomes:

```sql
select <old_column> as <new_column> from <observed_relation>
```

If no usable query exists, Cutset uses the exact logical dataset name parsed
from the verified source dataset URN and labels the result `schema_grounded`
rather than `query_grounded`.

The remediation record gains its grounding mode and supporting query URN. The
validator requires a `query_grounded` relation and old-column reference to
match the cited observed SQL. Both modes retain the existing single-statement,
read-only alias restriction and dbt YAML checks. Unparseable or ambiguous
observed SQL is ignored; Cutset never guesses a relation from a partial parse.

## Reporting and Write-Back

Markdown gains two compact sections after lineage:

1. ranked impact, with score, factor codes, owner, quality state, and usage
   count;
2. remediation grounding, naming the query URN or verified dataset identity.

JSON includes the complete normalized context and ranking records. DataHub
write-back continues to use the canonical Markdown content and exact affected
URNs, so the durable impact document automatically gains the same evidence.
Risk tags remain limited to current source and downstream evidence targets.

## Failure Behavior

- A required context tool missing from the installed toolkit is a context
  failure, not an empty result.
- Entity response omissions, duplicate URNs, malformed shapes, or unverified
  pagination mark evidence incomplete.
- Empty optional metadata is represented explicitly and does not fail a run.
- Query and assertion retrieval failure cannot be downgraded to zero usage or
  zero failures.
- Invalid generated remediation remains exit code `5`; incomplete DataHub
  evidence remains exit code `3`.
- No mutation occurs unless enriched evidence is complete and remediation is
  valid.

## Testing and Live Proof

Unit tests will cover normalization, empty optional metadata, malformed
responses, pagination, ranking factors and tie-breaking, query selection,
grounding validation, JSON/Markdown output, and mutation guards.

The controlled DataHub seed will add real owner, tag, glossary, and SQL-query
metadata where supported by DataHub v1.6.0. The live integration test must prove
that Cutset retrieves the seeded context, reports the ML model first, cites a
real query for remediation, writes the enriched document, and updates that same
document on an identical second run. If a seeded assertion cannot be expressed
through a supported v1.6.0 entity/aspect contract, the live test will verify the
real explicit zero-assertion response rather than simulate one.

## Completion Criteria

- Enriched reads use the installed Agent Context Kit tools against real
  DataHub.
- Every affected asset has normalized, completeness-aware context.
- Ranking is deterministic and separately tested from merge policy.
- A real observed query grounds the demonstrated compatibility SQL.
- Reports and DataHub write-back contain the enriched evidence.
- Missing or malformed enrichment fails closed.
- Unit, package, CLI, and live idempotency verification pass.
