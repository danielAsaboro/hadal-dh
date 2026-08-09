# Governed Change Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real, resumable graph-to-work-to-graph Cutset case flow on top of the verified impact analyzer, with GitHub execution, SHA-bound approvals, deterministic validation, DataHub persistence, and a focused coordination workspace.

**Architecture:** Immutable domain objects and canonical JSON form the case contract. Pure compilers and policy functions derive tasks, requirements, blockers, and admission from existing verified `ImpactReport` evidence. Network adapters for DataHub and GitHub perform explicit preflight, mutation, reread, and verification; application services orchestrate them without letting remote status override deterministic facts.

**Tech Stack:** Python 3.11, dataclasses, Typer, DataHub Agent Context Kit, `httpx`, `sqlglot`, PyYAML, standard-library WSGI/HTML, pytest, real Git repositories in tests, live DataHub and GitHub integration tests behind explicit environment gates.

## Global Constraints

- Preserve the verified `review` command and its live behavior until replacement proof passes.
- No mocks, placeholders, fake integrations, guessed identifiers, or simulated success in shipped behavior.
- Test fixtures may represent captured service responses, but judged proof uses real Git, DataHub, and GitHub.
- DataHub remains the governed source and durable institutional memory.
- Every case revision, approval, receipt, projection, and decision binds the exact head SHA.
- Deterministic policy owns merge authority and fails closed.
- Remote mutations require exact reread verification.
- Reruns update stable case and work identities and fail on duplicates.
- Secrets never enter artifacts, DataHub documents, issue bodies, logs, or output.

---

### Task 1: Canonical case domain and identities

**Files:**
- Create: `src/cutset/case_domain.py`
- Create: `src/cutset/case_serialization.py`
- Test: `tests/test_case_domain.py`
- Test: `tests/test_case_serialization.py`

**Interfaces:**
- Consumes: existing `AssetRef`, `ColumnRename`, and `LineagePath` values.
- Produces: `CaseState`, `WorkKind`, `ApprovalRole`, `ProjectionState`, `CaseRevision`, `WorkItem`, `ApprovalRequirement`, `ApprovalDecision`, `ValidationReceipt`, `ExternalProjection`, `AdmissionDecision`, `ChangeCase`, `case_key(...)`, `revision_key(...)`, `work_key(...)`, `case_to_dict(...)`, `case_from_dict(...)`, `render_case_json(...)`, and `case_content_hash(...)`.

- [ ] **Step 1: Write failing identity and immutability tests**

```python
def test_case_key_is_stable_but_revision_changes_with_head():
    key = case_key("owner/repo", source_urn, change)
    assert key == case_key("owner/repo", source_urn, change)
    assert revision_key(key, "base", "head-a", "evidence") != revision_key(
        key, "base", "head-b", "evidence"
    )

def test_work_key_ignores_input_order():
    assert work_key(case_key_value, owner_urn, WorkKind.CONSUMER_ACK, (urn_b, urn_a)) == work_key(
        case_key_value, owner_urn, WorkKind.CONSUMER_ACK, (urn_a, urn_b)
    )
```

- [ ] **Step 2: Run the domain tests and verify RED**

Run: `.venv/bin/python -m pytest tests/test_case_domain.py -q`  
Expected: collection failure because `cutset.case_domain` does not exist.

- [ ] **Step 3: Implement immutable enums, values, and SHA-256-derived identities**

Use frozen slotted dataclasses. Stable keys use a canonical `\x1f`-separated UTF-8 payload and the first 24 lowercase hexadecimal SHA-256 characters. Reject empty repository IDs, non-URN assets, empty SHAs, duplicate requirements, and mismatched nested revision keys in `ChangeCase.__post_init__`.

- [ ] **Step 4: Run domain tests and verify GREEN**

Run: `.venv/bin/python -m pytest tests/test_case_domain.py -q`  
Expected: all Task 1 domain tests pass.

- [ ] **Step 5: Write failing canonical round-trip and hash tests**

```python
def test_canonical_case_round_trip_is_byte_stable(case):
    encoded = render_case_json(case)
    assert render_case_json(case_from_dict(json.loads(encoded))) == encoded

def test_hash_excludes_only_its_own_value(case):
    digest = case_content_hash(case)
    assert len(digest) == 64
    assert case_content_hash(replace(case, content_hash=digest)) == digest
```

- [ ] **Step 6: Run serialization tests and verify RED**

Run: `.venv/bin/python -m pytest tests/test_case_serialization.py -q`  
Expected: failure because serializers are absent.

- [ ] **Step 7: Implement exact schema-versioned serialization**

Use `schema_version = 1`, ISO-8601 UTC timestamps ending in `Z`, sorted dictionaries, stable tuple ordering, `json.dumps(..., sort_keys=True, indent=2)`, and a terminating newline. Deserialization rejects unknown schema versions and inconsistent keys/hashes.

- [ ] **Step 8: Run Task 1 tests and the baseline suite**

Run: `.venv/bin/python -m pytest tests/test_case_domain.py tests/test_case_serialization.py -q && .venv/bin/python -m pytest -q`  
Expected: new tests pass; existing 72 tests still pass and two live tests skip.

- [ ] **Step 9: Commit**

```bash
git add src/cutset/case_domain.py src/cutset/case_serialization.py tests/test_case_domain.py tests/test_case_serialization.py
git commit -m "feat: add canonical change case domain"
```

### Task 2: Graph-derived case compiler

**Files:**
- Create: `src/cutset/case_compiler.py`
- Test: `tests/test_case_compiler.py`

**Interfaces:**
- Consumes: `ImpactReport` and Task 1 domain types.
- Produces: `compile_case(report: ImpactReport, existing: ChangeCase | None = None, created_at: datetime | None = None) -> ChangeCase` and `EvidenceCompilationError`.

- [ ] **Step 1: Write failing compilation tests**

Cover stable reruns, a new revision for a new head, source producer work, grouped consumer work, exact lineage URN retention, separate producer/consumer approvals, ML action classification, unowned-asset blockers, and refusal to create work from incomplete evidence.

```python
def test_compiler_groups_paths_by_real_owner_and_retains_all_urns(report):
    case = compile_case(report, created_at=FIXED_TIME)
    consumer = next(item for item in case.work_items if item.kind is WorkKind.CONSUMER_ACK)
    assert consumer.owner_urn == "urn:li:corpuser:consumer"
    assert consumer.affected_urns == tuple(sorted((dataset_urn, model_urn)))
```

- [ ] **Step 2: Run compiler tests and verify RED**

Run: `.venv/bin/python -m pytest tests/test_case_compiler.py -q`  
Expected: import failure for `cutset.case_compiler`.

- [ ] **Step 3: Implement deterministic compilation**

Index `AssetContext` by URN. Require exactly one source owner for producer work and at least one owner per affected asset. Preserve all valid owners as requirements when several exist; never choose one by ordering. Group only identical owner/action combinations. Compute an evidence fingerprint from source, schema, paths, contexts, and decision—not rendered prose.

- [ ] **Step 4: Verify compiler GREEN and baseline**

Run: `.venv/bin/python -m pytest tests/test_case_compiler.py -q && .venv/bin/python -m pytest -q`  
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/cutset/case_compiler.py tests/test_case_compiler.py
git commit -m "feat: compile graph evidence into change cases"
```

### Task 3: Deterministic case state and admission policy

**Files:**
- Create: `src/cutset/case_policy.py`
- Test: `tests/test_case_policy.py`

**Interfaces:**
- Consumes: Task 1 case types.
- Produces: `evaluate_case(case: ChangeCase, observed_head_sha: str | None) -> AdmissionDecision`, `derive_state(...) -> CaseState`, and stable `BlockerCode` values.

- [ ] **Step 1: Write a failing policy matrix**

```python
@pytest.mark.parametrize(
    ("mutation", "blocker"),
    [
        (without_complete_evidence, BlockerCode.CONTEXT_INCOMPLETE),
        (without_owner_mapping, BlockerCode.IDENTITY_MAPPING_MISSING),
        (without_projection_verification, BlockerCode.PROJECTION_UNVERIFIED),
        (without_approval, BlockerCode.APPROVAL_MISSING),
        (without_valid_receipt, BlockerCode.VALIDATION_MISSING),
        (with_changed_head, BlockerCode.STALE_HEAD),
        (without_datahub_verification, BlockerCode.WRITEBACK_UNVERIFIED),
    ],
)
def test_each_missing_fact_blocks(base_ready_case, mutation, blocker):
    assert blocker in evaluate_case(mutation(base_ready_case), base_ready_case.head_sha).blockers
```

- [ ] **Step 2: Run policy tests and verify RED**

Run: `.venv/bin/python -m pytest tests/test_case_policy.py -q`  
Expected: missing module failure.

- [ ] **Step 3: Implement pure policy evaluation**

Return all blockers in stable enum order. Approval decisions must match requirement ID, role, owner, revision, and head and must be `APPROVE`. Receipts must match required work IDs and current artifact hashes. An admission may be allowed only with no blockers.

- [ ] **Step 4: Verify policy GREEN and baseline**

Run: `.venv/bin/python -m pytest tests/test_case_policy.py -q && .venv/bin/python -m pytest -q`  
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/cutset/case_policy.py tests/test_case_policy.py
git commit -m "feat: enforce deterministic case admission"
```

### Task 4: Case reports and local verified replicas

**Files:**
- Create: `src/cutset/case_reporting.py`
- Create: `src/cutset/local_case_store.py`
- Test: `tests/test_case_reporting.py`
- Test: `tests/test_local_case_store.py`

**Interfaces:**
- Consumes: canonical cases and policy decisions.
- Produces: `render_case_markdown(case)`, `write_case_artifacts(case, output)`, and `LocalCaseStore.load/save_verified`.

- [ ] **Step 1: Write failing report and atomic-store tests**

Assert reports expose exact SHAs, URNs, path nodes, owners, work keys, approval state, receipt hashes, blockers, and external URLs. Assert local writes use a temporary sibling plus `Path.replace`, reject symlinks, and reject a case whose content hash is invalid.

- [ ] **Step 2: Verify RED**

Run: `.venv/bin/python -m pytest tests/test_case_reporting.py tests/test_local_case_store.py -q`  
Expected: missing modules.

- [ ] **Step 3: Implement human and machine views**

The JSON is the canonical Task 1 serializer. Markdown is derived entirely from it. `save_verified` requires `datahub_verified=True` when persistence was requested; local-only plan output is marked clearly as unpersisted and can never satisfy admission.

- [ ] **Step 4: Verify GREEN, baseline, and commit**

Run: `.venv/bin/python -m pytest tests/test_case_reporting.py tests/test_local_case_store.py -q && .venv/bin/python -m pytest -q`

```bash
git add src/cutset/case_reporting.py src/cutset/local_case_store.py tests/test_case_reporting.py tests/test_local_case_store.py
git commit -m "feat: render and store verified change cases"
```

### Task 5: DataHub canonical case persistence

**Files:**
- Create: `src/cutset/datahub_case_store.py`
- Modify: `src/cutset/datahub_gateway.py`
- Test: `tests/test_datahub_case_store.py`
- Modify: `tests/integration/test_datahub_gateway.py`

**Interfaces:**
- Consumes: `DataHubGateway._invoke`, `ChangeCase`, and canonical serializers.
- Produces: `DataHubCaseStore.find(case_key)`, `load(case_key)`, `save_and_verify(case) -> PersistedCase`, and `DataHubCaseStoreError`.

- [ ] **Step 1: Write failing exact-match, duplicate, and reread tests**

Use captured Agent Context Kit response-shaped tools. Assert exact title matching, no fuzzy update, duplicate hard failure, related assets limited to case evidence, save response validation, `get_entities` reread, and content-hash equality.

- [ ] **Step 2: Verify RED**

Run: `.venv/bin/python -m pytest tests/test_datahub_case_store.py -q`  
Expected: missing module.

- [ ] **Step 3: Implement stable document encoding and verified persistence**

Use title `Cutset case <case_key>`. Store a short human summary, delimiter `CUTSET_CASE_JSON_V1`, and canonical JSON. Search all returned exact matches; reject incomplete pagination. After `save_document`, call `get_entities` on the returned URN, extract document content, decode the envelope, and verify case key, revision key, and content hash.

- [ ] **Step 4: Add live DataHub round-trip coverage**

Extend the existing integration test to save one case twice and assert the same document URN and current revision are returned. Skip only when the existing explicit live environment contract is absent.

- [ ] **Step 5: Run local and optional live tests**

Run: `.venv/bin/python -m pytest tests/test_datahub_case_store.py -q && .venv/bin/python -m pytest -q`  
Expected: local suite passes.  
Run when configured: `.venv/bin/python -m pytest tests/integration/test_datahub_gateway.py -q -m integration`  
Expected: real DataHub tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/cutset/datahub_case_store.py src/cutset/datahub_gateway.py tests/test_datahub_case_store.py tests/integration/test_datahub_gateway.py
git commit -m "feat: persist canonical cases in DataHub"
```

### Task 6: Real GitHub task projection and reconciliation

**Files:**
- Modify: `pyproject.toml`
- Create: `src/cutset/github_connector.py`
- Test: `tests/test_github_connector.py`
- Create: `tests/integration/test_github_connector.py`

**Interfaces:**
- Consumes: repository slug, PR number, explicit owner mappings, token, `ChangeCase` work items.
- Produces: `GitHubConnector.preflight`, `sync_work`, `reconcile`, `verify_actor`, `publish_status`, `GitHubProjectionError`, and updated `ExternalProjection` values.

- [ ] **Step 1: Add explicit `httpx>=0.27,<1` dependency and write failing HTTP contract tests**

Use `httpx.MockTransport` only in tests to assert exact official REST requests and responses. Production construction always uses a real `httpx.Client` pointed at `https://api.github.com` unless an explicit test-only client is injected.

Cover PR-head mismatch, unmapped owner, ineligible assignee, pagination, exact marker matching, duplicate markers, create, update, reread mismatch, token-principal lookup, repository permission, status creation, and combined-status verification.

- [ ] **Step 2: Verify RED**

Run: `.venv/bin/python -m pytest tests/test_github_connector.py -q`  
Expected: missing module.

- [ ] **Step 3: Implement preflight and idempotent issues**

Issue bodies include:

```text
<!-- cutset-work-key:<work_key> -->
<!-- cutset-case-key:<case_key> -->
<!-- cutset-revision-key:<revision_key> -->
<!-- cutset-head-sha:<head_sha> -->
```

List `/repos/{repo}/issues?state=all&per_page=100`, follow only same-origin `Link` URLs, and match markers exactly. Verify all principals and desired work before the first mutation. Reread each issue after create/update.

- [ ] **Step 4: Implement actor and commit-status verification**

`verify_actor` calls `/user`, compares exact login, and calls the repository collaborator-permission endpoint. `publish_status` uses context `cutset/change-case`, target URL from the workspace when configured, and maps allowed to `success`, blockers to `failure`, and incomplete execution to `pending`. Reread `/commits/{ref}/status` and verify context, state, and target SHA.

- [ ] **Step 5: Add gated live GitHub integration test**

Require `CUTSET_GITHUB_TOKEN`, `CUTSET_GITHUB_REPOSITORY`, `CUTSET_GITHUB_PR`, `CUTSET_GITHUB_TEST_ASSIGNEE`, and `CUTSET_GITHUB_HEAD_SHA`. Create/update an issue with a deterministic integration key, reread it, verify the actor, publish a pending status, and rerun without duplication.

- [ ] **Step 6: Run tests and commit**

Run: `.venv/bin/python -m pytest tests/test_github_connector.py -q && .venv/bin/python -m pytest -q`

```bash
git add pyproject.toml src/cutset/github_connector.py tests/test_github_connector.py tests/integration/test_github_connector.py
git commit -m "feat: synchronize graph-derived work with GitHub"
```

### Task 7: SHA-bound approvals and executable validator receipts

**Files:**
- Create: `src/cutset/case_actions.py`
- Create: `src/cutset/validation_runner.py`
- Test: `tests/test_case_actions.py`
- Test: `tests/test_validation_runner.py`

**Interfaces:**
- Consumes: `ChangeCase`, verified GitHub actor, repository path, artifact paths, command arrays.
- Produces: `record_approval(...) -> ChangeCase`, `run_validation(...) -> tuple[ValidationReceipt, ...]`, and controlled errors.

- [ ] **Step 1: Write failing approval tests**

Assert actor owner mapping, role, revision, head, permission, duplicate idempotency, conflicting-decision rejection, and stale-approval invalidation.

- [ ] **Step 2: Verify approval RED and implement minimal action**

Run: `.venv/bin/python -m pytest tests/test_case_actions.py -q`  
Expected: missing module. Implement immutable case replacement only after a `VerifiedGitHubActor` is supplied by the real connector.

- [ ] **Step 3: Write failing real-command receipt tests**

Use temporary repositories and `sys.executable -c` argument arrays. Assert exit status, stdout/stderr hashes, artifact SHA-256, path containment, timeout failure, nonzero failure, revision binding, and changed-artifact rejection.

- [ ] **Step 4: Implement command and structural validators**

Use `subprocess.run(args, cwd=repo, capture_output=True, text=False, timeout=...)` with `shell=False`. Add SQL/YAML/remediation structural checks by calling existing validators. Never transform a missing command into a skipped receipt.

- [ ] **Step 5: Verify GREEN and commit**

Run: `.venv/bin/python -m pytest tests/test_case_actions.py tests/test_validation_runner.py -q && .venv/bin/python -m pytest -q`

```bash
git add src/cutset/case_actions.py src/cutset/validation_runner.py tests/test_case_actions.py tests/test_validation_runner.py
git commit -m "feat: bind approvals and validation receipts to revisions"
```

### Task 8: Resumable orchestration and CLI

**Files:**
- Create: `src/cutset/case_application.py`
- Modify: `src/cutset/cli.py`
- Test: `tests/test_case_application.py`
- Modify: `tests/test_cli.py`

**Interfaces:**
- Consumes: existing analyzer, compiler, stores, GitHub connector, actions, validators, policy.
- Produces: `plan_case`, `sync_case`, `approve_case`, `validate_case`, `reconcile_case`, `decide_case`, and Typer `case` command group.

- [ ] **Step 1: Write failing orchestration tests around real temporary Git repositories**

Assert plan writes impact reports first, refuses remote sync for incomplete cases, persists after each transition, handles partial remote failure as a blocker, reloads the same case, invalidates a stale head, and produces stable exit codes.

- [ ] **Step 2: Verify RED**

Run: `.venv/bin/python -m pytest tests/test_case_application.py -q`  
Expected: missing module.

- [ ] **Step 3: Implement transaction-shaped application services**

Each service performs load -> preflight -> action -> recompute -> DataHub save/reread -> local verified replica. No service reports success before the final verification.

- [ ] **Step 4: Write failing CLI tests and add commands**

Commands use explicit `--case-dir`, `--repository-id`, `--github-repository`, `--pull-request`, and owner-map YAML paths. Secrets are environment-only. Map input/context/validation/writeback/external/admission failures to documented nonzero exit codes while keeping the existing `review` codes stable.

- [ ] **Step 5: Verify CLI, suite, and commit**

Run: `.venv/bin/python -m pytest tests/test_case_application.py tests/test_cli.py -q && .venv/bin/python -m pytest -q`

```bash
git add src/cutset/case_application.py src/cutset/cli.py tests/test_case_application.py tests/test_cli.py
git commit -m "feat: orchestrate resumable governed change cases"
```

### Task 9: Coordination workspace

**Files:**
- Create: `src/cutset/workspace.py`
- Create: `src/cutset/workspace_assets.py`
- Test: `tests/test_workspace.py`
- Modify: `src/cutset/cli.py`

**Interfaces:**
- Consumes: verified local case artifacts.
- Produces: `WorkspaceApplication`, pure `render_case_page(case) -> str`, `render_case_index(cases) -> str`, and `cutset serve`.

- [ ] **Step 1: Write failing HTML behavior tests**

Assert escaped metadata, visible blocker summary, exact SHAs and URNs, lineage path chains, owner task states, approvals, receipt hashes, GitHub links, DataHub persistence state, no success language for unverified projections, keyboard navigation, and responsive landmark structure.

- [ ] **Step 2: Verify RED**

Run: `.venv/bin/python -m pytest tests/test_workspace.py -q`  
Expected: missing module.

- [ ] **Step 3: Implement a focused server-rendered workspace**

Use standard-library WSGI and embedded static CSS. Bind to `127.0.0.1` by default. Resolve case files only below the configured root. Routes are GET-only in the first verified slice: `/`, `/cases/<case_key>`, and `/health`. State-changing operations remain authenticated CLI commands and are shown as exact operator instructions.

- [ ] **Step 4: Verify workspace and commit**

Run: `.venv/bin/python -m pytest tests/test_workspace.py -q && .venv/bin/python -m pytest -q`

```bash
git add src/cutset/workspace.py src/cutset/workspace_assets.py src/cutset/cli.py tests/test_workspace.py
git commit -m "feat: add governed change coordination workspace"
```

### Task 10: Real end-to-end proof and idempotency

**Files:**
- Create: `scripts/run_governed_demo.py`
- Create: `docs/governed-demo.md`
- Create: `examples/change-case.json`
- Create: `examples/change-case.md`
- Create: `examples/github-task.md`
- Modify: `docs/verification.md`

**Interfaces:**
- Consumes: configured real DataHub, real Git repository, real GitHub repository/PR, mappings, and validator commands.
- Produces: a recorded real run, sanitized artifacts, stable remote identifiers, and rerun comparison.

- [ ] **Step 1: Implement the demo runner as orchestration—not a simulator**

The script validates required environment variables, invokes installed Cutset commands with argument arrays, captures exit codes and hashes, queries DataHub and GitHub after each phase, and redacts tokens. It contains no fallback data path.

- [ ] **Step 2: Run the blocked phase against real services**

Expected: case persists in DataHub; real GitHub work projections exist; commit status is failure or pending; merge admission is blocked for listed missing approvals/receipts.

- [ ] **Step 3: Complete real task, approval, and validation actions**

Expected: mapped GitHub actor is verified; generated artifacts exist in the real Git repository; configured validators execute successfully; approvals bind the current head.

- [ ] **Step 4: Run the admitted phase and reread both services**

Expected: deterministic admission is allowed, GitHub status is success, DataHub resolution matches the case hash.

- [ ] **Step 5: Rerun and verify idempotency**

Expected: same case document URN, same work issue numbers, no duplicate markers, and byte-stable canonical case when no external facts changed.

- [ ] **Step 6: Sanitize and commit only real output**

```bash
git add scripts/run_governed_demo.py docs/governed-demo.md docs/verification.md examples/change-case.json examples/change-case.md examples/github-task.md
git commit -m "docs: record governed change live proof"
```

### Task 11: Public repository and hackathon delivery

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `.github/workflows/cutset.yml`
- Modify: `docs/architecture.md`
- Create: `docs/security.md`
- Parent-private create: `submission/submission-copy.md`
- Parent-private create: `submission/demo-script.md`
- Parent-private create: `submission/api-feedback.md`
- Parent-private create: `submission/final-requirements-audit.md`

**Interfaces:**
- Consumes: only verified capabilities and real proof from Task 10.
- Produces: reproducible public project and complete submission materials.

- [ ] **Step 1: Rewrite the README around the actual verified product**

Include value proposition, three-minute path, architecture, exact prerequisites, DataHub/GitHub permissions, setup, commands, failure semantics, sample outputs, security, attribution, and proof links. Do not publish private strategy or credentials.

- [ ] **Step 2: Update CI without exposing untrusted code or secrets**

Keep trusted-base execution. Add case artifacts and deterministic status output. Remote mutation steps run only on trusted events with explicitly available secrets.

- [ ] **Step 3: Produce submission and video copy from the real run**

The video script shows the actual Git diff, DataHub evidence, case workspace, GitHub task, validators, blocked/admitted decision, DataHub resolution, and idempotent rerun in under three minutes.

- [ ] **Step 4: Run the final requirement audit**

Check every line of `resources/hackathon_requirements.md`, official rules, repository visibility, Apache 2.0 detection, public video visibility, setup from a clean clone, real external links, and judging-period availability.

- [ ] **Step 5: Run final verification and commit public files**

Run: `.venv/bin/python -m pytest -q`  
Run: `.venv/bin/python -m cutset.cli --help`  
Run: `git diff --check`  
Expected: all local tests pass, only explicitly gated live tests skip, help renders, and no whitespace errors.

```bash
git add README.md .env.example .github/workflows/cutset.yml docs/architecture.md docs/security.md
git commit -m "docs: prepare Cutset hackathon submission"
```
