# Cutset Governed Change Coordination Design

Date: 2026-08-09  
Approval: authorized by the user on 2026-08-09 with autonomous decision-making and no clarification pause

## Outcome

Cutset evolves from a one-shot impact checker into a DataHub-native governed change coordination system. A real dbt diff becomes a stable, revisioned change case. DataHub graph dependencies become accountable work. Work is projected into GitHub for real execution, reconciled, validated, and admitted or blocked by deterministic policy. Every transition and final outcome is written back to DataHub.

The verified impact-review command remains operational until the new case flow completes a stronger live proof.

## Decisions made without further questions

- Cutset owns its coordination workspace and domain model.
- DataHub is the governed evidence source and institutional memory.
- GitHub is the first and only shipped external connector until another service is exercised for real.
- The first change type remains one dbt schema-column rename.
- The first end-to-end case may affect multiple datasets, jobs, features, or models within three lineage hops.
- Work is derived per affected owned consumer, deduplicated by owner, required action, and exact affected URNs.
- Missing ownership or identity mapping blocks the case; Cutset does not create unassigned placeholder work.
- GitHub issues are task projections. A task is complete only when its required receipt validates for the current head SHA.
- Approvals are captured by Cutset only after GitHub verifies the token principal, repository permission, and current pull-request head SHA.
- GitHub commit status expresses the deterministic admission result. It never substitutes for DataHub write-back.
- The workspace is a focused local web application backed by verified case artifacts; it does not become a generic work-management product.
- The existing Python 3.11 package remains the implementation base.

## Alternatives

### GitHub-only orchestration

The canonical coordination state would live in issues, reviews, and checks. This is fast but collapses Cutset into a GitHub adapter and makes other execution surfaces difficult. Rejected.

### Cutset-native coordination with GitHub projection

Cutset owns the case, task, approval, receipt, and policy model. DataHub stores durable institutional history. GitHub carries actionable projections and the merge status. This is selected because it preserves DataHub authority while making Cutset a real product.

### General relational work platform

Arbitrary tables, forms, automations, views, and connectors would imitate commodity work systems and cannot be proved by the deadline. Rejected.

## Architecture

```text
                         +----------------------+
Git repository -------->| change analysis      |
                         +----------+-----------+
                                    |
                                    v
DataHub Agent Context --> evidence compiler
                                    |
                                    v
                         +----------------------+
                         | ChangeCase aggregate |
                         | revision + tasks     |
                         | approvals + receipts |
                         +---+--------------+---+
                             |              |
                   persist + verify      project + reconcile
                             |              |
                             v              v
                         DataHub          GitHub
                             ^              |
                             |              v
                         resolution <--- validators
                                    |
                                    v
                           admission policy
                                    |
                             GitHub commit status
                                    |
                                    v
                          Cutset workspace views
```

## Components

### Case domain

`case_domain.py` contains immutable value objects and enums. It has no network or filesystem dependencies.

Core identities:

- `case_key`: stable logical identity derived from repository, source URN, change kind, source path, old field, and new field;
- `revision_key`: immutable identity derived from case key, base SHA, head SHA, and evidence fingerprint;
- `work_key`: stable identity derived from case key, affected URNs, owner URN, and action kind.

Core values:

- `CaseRevision`
- `ChangeCase`
- `WorkItem`
- `ApprovalRequirement`
- `ApprovalDecision`
- `ArtifactReceipt`
- `ValidationReceipt`
- `ExternalProjection`
- `AdmissionDecision`

Serialization uses a schema-versioned canonical JSON document with sorted object keys and stable list ordering. The content hash is computed over this canonical form, excluding the hash field itself.

### Evidence compiler

The existing impact analysis remains the trusted evidence acquisition path. `case_compiler.py` converts an `ImpactReport` into a case revision without losing original report semantics.

Compilation rules:

- incomplete evidence produces a blocked case and no external mutations;
- every downstream target must have an exact lineage path;
- the producer work item is assigned to a verified owner of the source asset;
- consumer work items are assigned to owners returned for affected assets;
- unowned affected assets become explicit blockers, never synthetic owners;
- work for the same owner and action may group several exact URNs while retaining every path;
- ML consumers create an ML-impact action, not a separate ML subsystem;
- policy requirements are deterministic functions of evidence and change type.

### Case policy

`case_policy.py` recomputes state and admission from facts. Stored state is a cache that must equal recomputation before persistence or remote mutation.

Admission requires:

- complete current evidence;
- an owner and eligible external principal for every required task;
- successful synchronization and exact reread of every external projection;
- validated completion receipt for every task;
- every required producer and consumer approval bound to the revision and head SHA;
- successful remediation validators;
- pull-request head equal to the case head;
- successful DataHub persistence and verification of the current case revision.

Any failure returns a stable blocker code and blocks merge. An LLM result is never an admission fact.

### Case persistence

`case_store.py` defines the persistence interface. `DataHubCaseStore` uses Agent Context Kit tools to find, create, update, reread, and verify one stable DataHub Analysis document per case.

The document title includes the exact case key. Its content contains a human summary followed by the canonical JSON envelope. Search matches must be exact and unique. Related assets come only from verified evidence. After saving, Cutset retrieves the document and verifies its URN, case key, revision key, and content hash.

The local `case.json` written beside reports is a verified operational replica and audit artifact, not the source of governed truth. It is updated only after DataHub persistence verifies successfully when write-back is requested.

### GitHub connector

`github_connector.py` uses the official REST API through `httpx`; there is no fake adapter in production.

Configuration comes from explicit values and environment secrets:

- repository slug;
- pull-request number;
- token;
- DataHub-owner-URN to GitHub-login mappings.

Behavior:

- verify repository and pull request;
- verify pull-request head SHA equals the case revision;
- verify each mapped login is an eligible repository assignee;
- list all issues using pagination and locate an exact hidden Cutset work-key marker;
- fail on duplicate matches;
- create or update one issue per work item;
- reread every issue and verify title, marker, assignee, case revision, and head SHA;
- reconcile issue state without treating closure as completion proof;
- verify approval actors using `/user` and repository permission before recording a decision;
- publish a commit status for the deterministic admission result;
- reread the combined status and verify the exact Cutset context and state.

No GitHub mutation occurs when evidence, ownership, mapping, permissions, or case identity is incomplete.

### Receipts and validators

`receipts.py` records facts produced by commands that actually ran. Each receipt includes command arguments, working tree, exit code, output hash, artifact hashes, start/end timestamps, revision key, and head SHA.

Validators execute with argument arrays, never a shell string. The first slice validates:

- generated SQL parses through `sqlglot`;
- generated dbt YAML parses and names the changed model/column with at least one test;
- changed-column compatibility maps the verified old field to the proposed new field;
- configured repository test commands return zero;
- artifact paths are inside the configured repository or case output root;
- artifact hashes match the receipt at decision time.

A validator that cannot run is a failed requirement, not a skipped success.

### Application services and CLI

New application services are resumable:

- `case plan`: analyze Git/DataHub and create or revise a case;
- `case sync-github`: project required work and verify projections;
- `case approve`: verify the GitHub actor and record a SHA-bound approval;
- `case validate`: execute validators and record receipts;
- `case reconcile`: reread GitHub and refresh projections;
- `case decide`: recompute admission, persist it, and publish GitHub status;
- `case show`: render canonical JSON or Markdown;
- `serve`: open the coordination workspace.

The existing `review` command remains unchanged until the replacement live proof passes.

### Coordination workspace

The workspace is server-rendered, accessible, and read-focused for the first complete slice. It displays the verified local replica of a DataHub-persisted case and provides copyable exact CLI actions for mutations that require authenticated operator identity.

Views:

- case list;
- case overview and blockers;
- evidence graph/path view;
- owner work board;
- approvals;
- remediation and validation receipts;
- external projections;
- resolution timeline.

The UI never labels a remote action successful unless the case contains the corresponding verified receipt.

## Data flow

### Plan

1. Resolve immutable Git revisions.
2. Parse one supported dbt column rename.
3. Resolve the source asset through DataHub search.
4. Retrieve and normalize complete context.
5. Compile stable case, revision, tasks, and requirements.
6. Render artifacts locally.
7. Persist to DataHub and reread when write-back is enabled.
8. Only after verification, mark the local replica as persisted.

### Sync

1. Load the current verified case.
2. Verify the current PR head.
3. Verify all owner mappings and assignee eligibility.
4. Preflight all desired projections before creating any.
5. Reconcile exact work-key matches.
6. Reread and verify every projection.
7. Update the case and persist/reread DataHub.

### Approve

1. Load the current case revision.
2. Verify PR head.
3. Query GitHub `/user` with the supplied token.
4. Verify the actor matches the governed owner mapping and has required repository permission.
5. Record the role-specific decision bound to head SHA.
6. Persist and reread DataHub.

### Validate and decide

1. Execute configured validators against the current repository and generated artifacts.
2. Record immutable receipts and hashes.
3. Reread external state and current Git head/PR head.
4. Recompute blockers and admission.
5. Persist and verify the decision in DataHub.
6. Publish and verify the GitHub commit status.
7. Persist the external status receipt and final resolution in DataHub.

## Failure and security behavior

- All missing or ambiguous context fails closed.
- Secrets are read from environment variables and never written to cases, logs, reports, issue bodies, or DataHub.
- Query literals remain redacted as in the verified slice.
- GitHub API errors include status and request identity but redact authorization values and response secrets.
- Partial remote mutation is represented explicitly and blocks subsequent admission until reconciliation verifies exact state.
- Duplicate DataHub documents or GitHub issues for one stable key are hard errors.
- A changed head SHA invalidates approvals, receipts, projections, and admission for the earlier revision.
- Unsupported changes return controlled input errors.
- The GitHub Action continues to run trusted base code and checks out the untrusted head only as data.

## Testing strategy

Unit and focused contract tests may use immutable response fixtures captured from documented or real service shapes. They do not simulate shipped success.

Test layers:

1. pure domain and canonical serialization tests;
2. compiler and deterministic policy tests;
3. real temporary Git repository tests;
4. HTTP contract tests against an in-process deterministic test server, not a fake production connector;
5. live DataHub integration tests gated by explicit environment variables;
6. live GitHub integration tests gated by explicit environment variables and an isolated repository/PR;
7. one judged end-to-end run using real Git, DataHub, GitHub, generated artifacts, validators, write-back, and an idempotent rerun.

Every production behavior is introduced through a failing test. Live capability claims require a recorded actual run.

## Migration and compatibility

- `ImpactReport` remains accepted as an input to the new compiler.
- Existing report JSON and Markdown remain emitted by `review`.
- The legacy DataHub impact document and risk tag remain available until the new case document has verified parity.
- No existing module is deleted in the initial implementation.
- After live replacement proof, `review` may become a compatibility wrapper around `case plan` and `case decide`.

## Definition of complete

The overhaul is complete only when:

- the new flow passes all local tests;
- the existing 72-test baseline remains green or is intentionally migrated with equivalent coverage;
- real DataHub plan and write-back succeed and are reread;
- real GitHub task synchronization, principal verification, and commit status succeed and are reread;
- remediation commands actually run and receipts validate;
- the case blocks before requirements and admits only after satisfying them;
- reruns update the same case and issues;
- the workspace displays the verified case without invented status;
- the public repository contains reproducible setup and real examples;
- the demo video and submission copy show only verified behavior; and
- every hackathon requirement is checked before submission.
