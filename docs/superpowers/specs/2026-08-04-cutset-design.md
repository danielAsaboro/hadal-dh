# Cutset Design

## Purpose

Cutset answers one question before a data-platform change merges: **what will this break?** It converts a real dbt pull-request diff into an evidence-backed impact verdict by joining Git context with DataHub’s metadata graph. When remediation is possible, it produces validated code and leaves durable context in both the pull request and DataHub.

The first release is deliberately narrow. It handles one renamed dbt column, traces downstream table and ML consequences, and returns a blocking or non-blocking review. This vertical slice proves the read → reason → act → write-back loop without hiding incomplete integrations behind a dashboard or demo mode.

## Design Principles

1. **Evidence before inference.** Every affected asset must come from DataHub search, entity retrieval, or lineage results. Cutset never constructs or guesses URNs.
2. **Determinism controls safety.** Parsing, impact classification, validation, idempotency keys, and exit codes are deterministic. The LLM explains evidence and drafts code; it does not decide whether unavailable evidence is safe.
3. **Fail closed.** Missing Git context, unresolved DataHub assets, truncated lineage, authentication failure, invalid generated code, or failed write-back cannot produce a safe verdict.
4. **Two durable records.** The GitHub review serves the developer at merge time; the DataHub impact document and risk metadata serve future humans and agents.
5. **One real path first.** The initial product supports a dbt column rename and no other schema-change type.

## System Boundary

Cutset runs as a Python CLI locally and in GitHub Actions. It reads a repository and its base/head refs, calls a self-hosted or managed DataHub instance through the Agent Context Kit, optionally invokes a configured LLM through LangChain, writes report artifacts to the repository workspace, and emits GitHub-compatible output. The initial release does not host a web application, execute warehouse migrations, merge pull requests, or retrain models.

## Components

### Change extraction

The Git adapter obtains a name-status and zero-context diff between two explicit revisions. The dbt change parser accepts YAML schema files and SQL model files but emits only a `ColumnRename` when removed and added fields can be resolved unambiguously for one model. Ambiguous changes become a blocked analysis with evidence, not an LLM guess.

### DataHub gateway

The gateway wraps the Agent Context Kit behind a typed interface. It resolves the changed dbt model by search, retrieves the entity and schema, traces downstream lineage with bounded hops, and returns normalized assets and paths. Mutation methods save an impact document and apply a pre-existing risk tag. Every method returns source URNs and tool evidence suitable for audit output.

### Impact policy

The policy engine is pure and deterministic. It assigns severity from verified evidence: unresolved source or incomplete lineage blocks; removed/renamed fields with downstream column consumers are high risk; affected ML features, models, or deployments are critical; resolved changes without downstream consumers are informational. The policy exposes stable reason codes for tests, CLI exit status, GitHub annotations, and idempotency.

### Remediation generator and validator

The generator receives the exact diff, current schema, downstream paths, queries, and policy result. It may draft a compatibility alias and dbt schema tests. The validator parses the generated YAML, compiles or parses SQL where the installed dbt adapter permits, and confirms that every referenced column exists in retrieved DataHub context or is explicitly introduced by the proposed diff. Failed validation discards the patch and preserves a blocking report.

### Reporters

One canonical `ImpactReport` drives three renderers: Markdown for humans and examples, JSON for automation, and GitHub workflow annotations/check output. The report contains the change, verdict, reason codes, affected assets, exact lineage paths, proposed remediation, validation results, DataHub write-back identifiers, and an idempotency key derived from repository identity plus base/head revisions.

### Orchestration

The application service sequences extraction, context retrieval, policy, optional generation, validation, local artifact persistence, and DataHub write-back. A repeated run for the same idempotency key updates or recognizes the same durable record rather than creating duplicate reports or tags.

## Data Flow

1. The CLI receives repository path, base revision, head revision, DataHub connection settings, and output directory.
2. Git returns the real diff; the parser emits one supported `ColumnRename` or a blocked result.
3. DataHub search resolves the model; entity/schema retrieval verifies old and new field context.
4. Downstream lineage produces normalized paths and affected assets, including ML entities when present.
5. The deterministic policy produces severity, merge verdict, and reason codes.
6. For remediable changes, the LLM drafts compatibility code and tests from the evidence bundle.
7. Deterministic validation accepts or rejects the generated artifacts.
8. Reporters write JSON and Markdown and emit GitHub-compatible output.
9. The gateway saves the impact report to DataHub and applies risk metadata when the verdict requires it.
10. The CLI exits `0` only for a verified non-blocking result; blocked analysis, unsafe impact, validation failure, and write-back failure use distinct nonzero codes.

## Error Handling and Safety

- Configuration errors are reported before any network or mutation call.
- DataHub reads are bounded and surface pagination/truncation state.
- No write occurs until the source asset and impact paths have been retrieved successfully.
- Mutation targets are restricted to resolved URNs from the current run.
- Generated artifacts are never applied automatically in the initial release; they are emitted as a reviewable patch.
- Secrets are read from environment variables, never written to reports or logs.
- Reports redact authorization headers and provider credentials.
- Partial write-back is reported explicitly with completed and failed operations.

## Testing Strategy

Pure domain logic uses table-driven unit tests with real diff/YAML fixtures. Git integration tests create temporary repositories and real commits. DataHub contract tests run against the installed Agent Context Kit types and recorded tool-shape fixtures derived from real local responses; the judged integration test runs against a real local DataHub quickstart. CLI tests assert exit codes and artifacts. Idempotency tests execute the same analyzed revisions twice. The final demo evidence includes a real DataHub transcript, Git revisions, generated files, validation output, and write-back identifiers.

## Public Deliverables

- Apache-2.0 public repository.
- Reproducible local DataHub and sample-data setup.
- CLI and GitHub Action entry point.
- Real `examples/` impact report and remediation output.
- Architecture and verification documentation.
- Public demo video shorter than three minutes.

## Deferred Work

Multi-column changes, deletions, type changes, arbitrary migration execution, hosted UI, Slack/PagerDuty actions, automatic PR creation, model retraining, and multi-repository orchestration are outside the first vertical slice.
