# Architecture

Cutset is a TypeScript coordination service around a canonical, versioned `ChangeCase`. DataHub owns the institutional record; GitHub owns only projected execution objects.

```text
Git repository                         DataHub metadata graph
base SHA → head SHA                    schema, ownership, governance
        │                              column + entity lineage, queries
        └──────────┬────────────────────────────┘
                   ▼
          evidence compiler (fail closed)
                   ▼
       canonical case + stable revision key
          │          │             │
          │          │             └─ deterministic policy
          │          └─ compatibility artifacts + executable receipts
          └─ owner work/approvals projected to GitHub
                   ▼
       two-phase DataHub document write + exact reread
                   ▼
        verified commit status: pending/failure/success
```

## Identity and idempotency

- `caseKey` binds repository, resolved source URN, and logical dbt change.
- `revisionKey` additionally binds base SHA, head SHA, and the canonical evidence fingerprint.
- `workKey` binds the case, work kind, owner URN, and affected URNs.
- A DataHub document title contains the stable case key. Exact search rejects duplicates and fuzzy matches.
- GitHub issue bodies carry exact hidden case/work/revision markers. Create and update operations are reread and compared.

## Trust boundaries

- Git commands use argument arrays with validated revisions; validators run with `shell:false`, timeouts, bounded output, and artifact containment checks.
- Dataset identity is resolved by DataHub search and confirmed by entity read. Cutset never guesses a dataset URN.
- Both column-level lineage and entity-level multi-hop lineage must report complete pagination. Exact paths preserve schema-field and intermediate DataJob URNs.
- DataJob/DataFlow nodes remain in audit paths but are not treated as end-consumer work targets.
- Owners come from the current graph. Zero or multiple owners block work derivation; an explicit DataHub-owner→GitHub-login mapping is also required.
- GitHub preflight verifies PR head SHA, repository, assignee eligibility, and all mappings before mutation.
- Approval decisions bind requirement, role, owner URN, verified GitHub actor, revision key, and head SHA.
- DataHub document writes are two phase: an unverified/blocked form is saved and reread before the verified form can be saved and reread.
- Policy can evaluate the intended final state inside that guarded write, but merge admission is returned only after the verified reread.

## DataHub MCP tools

Cutset uses `search`, `get_entities`, `list_schema_fields`, `get_lineage`, `get_lineage_paths_between`, `get_dataset_queries`, `search_documents`, `grep_documents`, and `save_document`. `get_dataset_assertions` is used only when advertised by the connected server. Purpose-built document tools avoid generic document expansion and keep the canonical envelope under the official 8,000-character read limit.

The case document contains a human summary and a delimited gzip/base64 canonical envelope. Its SHA-256 content hash is recomputed after every read.

## Merge authority

The pure policy evaluator emits stable blocker codes. Admission is allowed only when evidence and ownership are complete, the PR head matches, every work projection is verified, every required receipt succeeds for the same revision/SHA, every producer and consumer approval is verified, and final DataHub write-back is verified. GitHub receives the resulting commit status; it does not become the canonical store.
