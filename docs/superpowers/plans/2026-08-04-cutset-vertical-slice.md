# Cutset Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real CLI that analyzes one dbt column rename between Git revisions, resolves its DataHub asset and downstream lineage, assigns a deterministic merge verdict, emits auditable reports, and writes the impact record back to DataHub.

**Architecture:** Pure domain modules own change detection, normalized evidence, policy, remediation validation, and report rendering. Boundary adapters own Git subprocesses, Agent Context Kit calls, optional LLM generation, filesystem output, and GitHub Actions. The application service fails closed and performs DataHub mutations only after verified reads and deterministic validation.

**Tech Stack:** Python 3.11+, standard-library dataclasses/enums/subprocess, PyYAML, Typer, pytest, DataHub Agent Context Kit, LangChain/LangGraph, and GitHub Actions.

## Global Constraints

- Support exactly one unambiguous dbt column rename in the first vertical slice.
- Resolve every DataHub asset through search; never construct or guess a URN.
- Treat missing, truncated, or failed DataHub context as a blocking result.
- Keep merge safety deterministic; use an LLM only for explanation and remediation drafting.
- Never apply generated code automatically; emit a validated, reviewable patch.
- Write a durable impact document and risk metadata only to URNs retrieved in the current run.
- Preserve secrets outside reports and logs.
- Ship under Apache License 2.0 and preserve starter attribution.
- Use real Git repositories in integration tests and a real DataHub instance for judged verification.

## File Structure

- `pyproject.toml`: package metadata, runtime dependencies, CLI entry point, and pytest configuration.
- `src/cutset/domain.py`: immutable domain types, verdicts, reason codes, and report data.
- `src/cutset/change_detection.py`: unified-diff parser for one dbt column rename.
- `src/cutset/git_adapter.py`: validated Git revision diff execution.
- `src/cutset/policy.py`: pure evidence-to-verdict rules.
- `src/cutset/datahub_gateway.py`: real Agent Context Kit tool discovery, reads, normalization, and writes.
- `src/cutset/remediation.py`: prompt input, response parsing, and deterministic artifact validation.
- `src/cutset/reporting.py`: canonical JSON, Markdown, and GitHub output rendering.
- `src/cutset/application.py`: end-to-end orchestration and idempotency.
- `src/cutset/cli.py`: Typer command and stable exit-code mapping.
- `tests/fixtures/`: real unified diffs and sanitized DataHub response captures.
- `tests/`: focused unit and real Git integration tests.
- `.github/workflows/cutset.yml`: pull-request execution surface.
- `examples/`: judge-readable output from the verified local scenario.

---

### Task 1: Package and Detect One dbt Column Rename

**Files:**
- Create: `pyproject.toml`
- Create: `src/cutset/__init__.py`
- Create: `src/cutset/domain.py`
- Create: `src/cutset/change_detection.py`
- Create: `tests/fixtures/rename_customer_email.diff`
- Create: `tests/test_change_detection.py`

**Interfaces:**
- Produces: `ColumnRename(model_name: str, old_name: str, new_name: str, source_path: str)`.
- Produces: `UnsupportedChangeError` and `parse_column_rename(diff_text: str) -> ColumnRename`.

- [ ] **Step 1: Add packaging and test dependencies**

Create a setuptools `pyproject.toml` with package discovery under `src`, Python `>=3.11`, runtime dependencies `PyYAML>=6.0`, `typer>=0.12`, `datahub-agent-context[langchain]`, `langgraph`, `langchain-anthropic`, and `python-dotenv`, plus optional development dependencies `pytest>=8` and `pytest-cov>=5`. Register `cutset = "cutset.cli:app"` as the console script and set `testpaths = ["tests"]`.

- [ ] **Step 2: Write the failing rename parser tests**

```python
from pathlib import Path
import pytest

from cutset.change_detection import UnsupportedChangeError, parse_column_rename


def test_parses_one_dbt_column_rename():
    diff = Path("tests/fixtures/rename_customer_email.diff").read_text()
    assert parse_column_rename(diff).old_name == "email"
    assert parse_column_rename(diff).new_name == "email_address"
    assert parse_column_rename(diff).model_name == "customers"


def test_rejects_multiple_column_changes():
    with pytest.raises(UnsupportedChangeError, match="exactly one"):
        parse_column_rename("-      - name: email\n+      - name: email_address\n-      - name: id\n+      - name: customer_id\n")
```

- [ ] **Step 3: Run the tests and verify RED**

Run: `python -m pytest tests/test_change_detection.py -q`

Expected: collection fails because `cutset.change_detection` does not exist.

- [ ] **Step 4: Implement the immutable change type and minimal parser**

```python
@dataclass(frozen=True, slots=True)
class ColumnRename:
    model_name: str
    old_name: str
    new_name: str
    source_path: str


def parse_column_rename(diff_text: str) -> ColumnRename:
    removed = COLUMN_LINE.findall_removed(diff_text)
    added = COLUMN_LINE.findall_added(diff_text)
    if len(removed) != 1 or len(added) != 1:
        raise UnsupportedChangeError("expected exactly one removed and one added dbt column")
    path = parse_new_path(diff_text)
    return ColumnRename(Path(path).stem, removed[0], added[0], path)
```

Implement helpers with anchored regexes that only accept added/removed YAML `name:` entries and ignore diff headers.

- [ ] **Step 5: Run the focused and complete tests**

Run: `python -m pytest tests/test_change_detection.py -q && python -m pytest -q`

Expected: both commands pass.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml src tests
git commit -m "feat: detect a dbt column rename"
```

### Task 2: Read the Change from Real Git Revisions

**Files:**
- Create: `src/cutset/git_adapter.py`
- Create: `tests/test_git_adapter.py`

**Interfaces:**
- Consumes: `parse_column_rename(diff_text: str) -> ColumnRename`.
- Produces: `GitDiffRequest(repo: Path, base: str, head: str)` and `read_git_diff(request: GitDiffRequest) -> str`.

- [ ] **Step 1: Write a failing real-repository integration test**

```python
def test_reads_diff_between_real_commits(tmp_path):
    repo = initialize_repo_with_two_schema_commits(tmp_path)
    diff = read_git_diff(GitDiffRequest(repo, "HEAD~1", "HEAD"))
    assert "-      - name: email" in diff
    assert "+      - name: email_address" in diff
```

The test helper must call real `git init`, `git add`, and `git commit` commands with repository-local author configuration; it must not mock subprocesses.

- [ ] **Step 2: Run and verify RED**

Run: `python -m pytest tests/test_git_adapter.py -q`

Expected: import failure for `cutset.git_adapter`.

- [ ] **Step 3: Implement validated Git execution**

```python
def read_git_diff(request: GitDiffRequest) -> str:
    verify_repository(request.repo)
    verify_revision(request.repo, request.base)
    verify_revision(request.repo, request.head)
    completed = subprocess.run(
        ["git", "diff", "--unified=0", request.base, request.head, "--", "*.yml", "*.yaml", "*.sql"],
        cwd=request.repo,
        check=True,
        text=True,
        capture_output=True,
    )
    if not completed.stdout.strip():
        raise GitContextError("no dbt schema or SQL changes found")
    return completed.stdout
```

- [ ] **Step 4: Cover invalid revisions and empty diffs**

Add tests asserting `GitContextError` contains the failing revision or the explicit empty-diff reason and never leaks environment variables.

- [ ] **Step 5: Run all tests and commit**

Run: `python -m pytest -q`

```bash
git add src/cutset/git_adapter.py tests/test_git_adapter.py
git commit -m "feat: read dbt changes from git revisions"
```

### Task 3: Normalize Evidence and Decide Merge Safety

**Files:**
- Modify: `src/cutset/domain.py`
- Create: `src/cutset/policy.py`
- Create: `tests/test_policy.py`

**Interfaces:**
- Produces: `AssetRef`, `LineagePath`, `ImpactEvidence`, `Severity`, `ReasonCode`, and `ImpactDecision`.
- Produces: `decide(evidence: ImpactEvidence) -> ImpactDecision`.

- [ ] **Step 1: Write failing table-driven policy tests**

```python
@pytest.mark.parametrize(
    ("complete", "asset_types", "severity", "blocks"),
    [
        (False, (), Severity.BLOCKED, True),
        (True, (), Severity.INFO, False),
        (True, ("dataset",), Severity.HIGH, True),
        (True, ("mlFeature", "mlModel"), Severity.CRITICAL, True),
    ],
)
def test_decision_is_deterministic(complete, asset_types, severity, blocks):
    evidence = evidence_with_downstream_types(complete, asset_types)
    decision = decide(evidence)
    assert decision.severity is severity
    assert decision.blocks_merge is blocks
```

- [ ] **Step 2: Run and verify RED**

Run: `python -m pytest tests/test_policy.py -q`

Expected: import failure for missing domain types or `decide`.

- [ ] **Step 3: Implement normalized immutable evidence and reason codes**

Define stable enum values `context_incomplete`, `no_downstream_consumers`, `downstream_column_consumers`, and `ml_assets_affected`. Ensure the decision function depends only on normalized evidence and cannot call an LLM or network service.

- [ ] **Step 4: Add idempotency-key behavior**

```python
def test_analysis_key_is_stable():
    assert analysis_key("owner/repo", "abc", "def") == analysis_key("owner/repo", "abc", "def")
    assert analysis_key("owner/repo", "abc", "def") != analysis_key("owner/repo", "abc", "xyz")
```

Implement SHA-256 over a versioned, newline-delimited canonical string and expose the first 20 hexadecimal characters.

- [ ] **Step 5: Run all tests and commit**

Run: `python -m pytest -q`

```bash
git add src/cutset/domain.py src/cutset/policy.py tests/test_policy.py
git commit -m "feat: classify lineage impact deterministically"
```

### Task 4: Read and Write Real DataHub Context

**Files:**
- Create: `src/cutset/datahub_gateway.py`
- Create: `tests/test_datahub_normalization.py`
- Create: `tests/integration/test_datahub_gateway.py`
- Create: `scripts/capture_datahub_fixture.py`

**Interfaces:**
- Consumes: `ColumnRename`, `AssetRef`, `LineagePath`, and `ImpactEvidence`.
- Produces: `DataHubGateway.from_env()`, `collect_evidence(change: ColumnRename, max_hops: int = 3) -> ImpactEvidence`, and `write_back(report: ImpactReport) -> WriteBackResult`.

- [ ] **Step 1: Inspect installed Agent Context Kit tool schemas**

Run a small read-only command that creates `DataHubClient.from_env()`, calls `build_langchain_tools(client, include_mutations=True)`, and prints only tool names plus `args_schema.model_json_schema()`. Save the sanitized output under parent-private `submission/evidence/`; do not commit credentials or live metadata.

- [ ] **Step 2: Capture one real sanitized response per required read tool**

Against local DataHub, invoke `search`, `get_entities`, `list_schema_fields`, and `get_lineage` for the seeded model. Store sanitized JSON fixtures in `tests/fixtures/datahub/` and the unsanitized transcript only under parent-private `submission/evidence/`.

- [ ] **Step 3: Write failing normalization tests**

```python
def test_normalizes_lineage_paths_from_captured_response(captured_lineage):
    paths, complete = normalize_lineage(captured_lineage)
    assert complete is True
    assert paths[0].nodes[0].urn.startswith("urn:li:dataset:")
    assert any(node.entity_type == "mlModel" for path in paths for node in path.nodes)
```

- [ ] **Step 4: Run and verify RED**

Run: `python -m pytest tests/test_datahub_normalization.py -q`

Expected: import failure for `normalize_lineage`.

- [ ] **Step 5: Implement tool lookup, resolution, normalization, and fail-closed pagination**

Build a `{tool.name: tool}` map once. Invoke exact argument shapes discovered in Step 1. Require exactly one resolved source asset, confirm the old field exists, retain returned URNs verbatim, bound lineage to three hops, and mark evidence incomplete whenever result metadata indicates truncation or a next page.

- [ ] **Step 6: Write the live read integration test**

Mark the test `@pytest.mark.integration`; skip only when `CUTSET_INTEGRATION_DATASET` is absent. When enabled, require a real DataHub response and assert the resolved URN equals the configured dataset.

- [ ] **Step 7: Implement guarded write-back**

Use the discovered mutation schemas to call `save_document` and `add_tags`. Refuse any target URN absent from the current report evidence. Return per-operation identifiers/status and treat partial success as failure.

- [ ] **Step 8: Run tests and commit**

Run: `python -m pytest -q`

With local DataHub configured: `python -m pytest tests/integration/test_datahub_gateway.py -q -m integration`

```bash
git add src/cutset/datahub_gateway.py tests scripts/capture_datahub_fixture.py
git commit -m "feat: connect impact analysis to DataHub"
```

### Task 5: Generate and Validate a Reviewable Remediation

**Files:**
- Create: `src/cutset/remediation.py`
- Create: `tests/test_remediation.py`

**Interfaces:**
- Produces: `RemediationDraft(sql: str, schema_yaml: str, explanation: str)`.
- Produces: `generate_remediation(evidence, decision, model) -> RemediationDraft`.
- Produces: `validate_remediation(draft, evidence) -> ValidationResult`.

- [ ] **Step 1: Write failing validator tests before generator code**

```python
def test_accepts_alias_from_verified_old_to_new_column():
    draft = RemediationDraft("select email as email_address from upstream", VALID_SCHEMA_YAML, "compatibility alias")
    assert validate_remediation(draft, rename_evidence()).valid is True


def test_rejects_unseen_source_column():
    draft = RemediationDraft("select invented as email_address from upstream", VALID_SCHEMA_YAML, "")
    result = validate_remediation(draft, rename_evidence())
    assert result.valid is False
    assert "invented" in result.errors[0]
```

- [ ] **Step 2: Run and verify RED**

Run: `python -m pytest tests/test_remediation.py -q`

Expected: import failure for `cutset.remediation`.

- [ ] **Step 3: Implement deterministic YAML and SQL checks**

Parse YAML with `yaml.safe_load`. Tokenize the limited compatibility SQL shape and require every source identifier to occur in the verified schema or the change itself. Reject multiple statements, DDL/DML, comments containing instructions, and empty tests.

- [ ] **Step 4: Add structured LLM response parsing**

Require JSON with exactly `sql`, `schema_yaml`, and `explanation`; reject prose-wrapped or incomplete output. Keep model invocation behind a callable protocol so validation tests exercise real parser behavior without network calls.

- [ ] **Step 5: Run tests and commit**

Run: `python -m pytest -q`

```bash
git add src/cutset/remediation.py tests/test_remediation.py
git commit -m "feat: validate graph-grounded remediation"
```

### Task 6: Orchestrate, Report, and Expose the CLI

**Files:**
- Create: `src/cutset/reporting.py`
- Create: `src/cutset/application.py`
- Create: `src/cutset/cli.py`
- Create: `tests/test_reporting.py`
- Create: `tests/test_cli.py`
- Modify: `.env.example`

**Interfaces:**
- Produces: `ImpactReport` JSON/Markdown serialization.
- Produces: `analyze(request: AnalysisRequest, gateway: DataHubGateway) -> ImpactReport`.
- Produces: `cutset review --repo PATH --base REV --head REV --output DIR`.

- [ ] **Step 1: Write failing report snapshot tests**

```python
def test_markdown_contains_evidence_and_machine_reason_codes():
    markdown = render_markdown(critical_report())
    assert "## Verdict: BLOCK" in markdown
    assert "ml_assets_affected" in markdown
    assert "urn:li:mlModel:" in markdown
    assert "CUTSET ANALYSIS KEY" in markdown
```

- [ ] **Step 2: Run and verify RED**

Run: `python -m pytest tests/test_reporting.py tests/test_cli.py -q`

Expected: import failures for reporting and CLI modules.

- [ ] **Step 3: Implement canonical report rendering**

Serialize enums by stable string value, sort assets by URN, preserve lineage path order, and render secrets nowhere. Use the same `ImpactReport` for JSON, Markdown, and GitHub annotations.

- [ ] **Step 4: Implement application sequencing and exit codes**

Use `0` for verified non-blocking, `2` for unsupported/invalid input, `3` for incomplete context, `4` for unsafe impact, `5` for invalid remediation, and `6` for write-back failure. Persist local reports before attempting write-back so failures remain diagnosable.

- [ ] **Step 5: Write a real-Git CLI test**

Invoke the Typer test runner against a temporary two-commit repository. Patch only the external DataHub boundary with a captured-response gateway; do not mock Git or domain logic. Assert the report files and unsafe exit code.

- [ ] **Step 6: Run all tests and commit**

Run: `python -m pytest -q`

```bash
git add src/cutset/reporting.py src/cutset/application.py src/cutset/cli.py tests .env.example
git commit -m "feat: expose Cutset impact reviews through the CLI"
```

### Task 7: Ship the GitHub Action and Verified Demo Scenario

**Files:**
- Create: `.github/workflows/cutset.yml`
- Create: `examples/dbt/models/customers.yml`
- Create: `examples/dbt/models/customers.sql`
- Create: `examples/impact-report.json`
- Create: `examples/impact-report.md`
- Create: `examples/remediation/customers.sql`
- Create: `examples/remediation/customers.yml`
- Rewrite: `README.md`
- Create: `docs/architecture.md`
- Create: `docs/verification.md`

**Interfaces:**
- Consumes: the `cutset review` CLI and stable exit codes.
- Produces: a pull-request workflow, reproducible local tutorial links, and judge-readable verified evidence.

- [ ] **Step 1: Add a pull-request workflow using explicit base/head SHAs**

Configure checkout with full history, Python 3.11, dependency installation, and `cutset review --base "${{ github.event.pull_request.base.sha }}" --head "${{ github.event.pull_request.head.sha }}"`. Upload reports as artifacts even when Cutset blocks the merge. Require secrets only for the live DataHub/LLM job.

- [ ] **Step 2: Run the complete local scenario against real DataHub**

Seed the official dataset, create the dbt commits, run Cutset with real environment variables, and record commands plus outputs under parent-private `submission/evidence/`. Confirm the DataHub UI/API contains the saved impact document and risk metadata.

- [ ] **Step 3: Verify idempotency**

Run the identical base/head analysis twice. Confirm the second run does not create a duplicate document/tag and returns the same analysis key.

- [ ] **Step 4: Publish sanitized real examples**

Copy only sanitized outputs derived from the verified run into `examples/`. Each example must state the source revisions, analysis key, and whether the DataHub write succeeded.

- [ ] **Step 5: Rewrite README as a judge-oriented explanation plus linked how-to**

Lead with the problem, show the 60-second demo flow, state what is real, list DataHub capabilities used, link setup/verification docs, disclose the official starter, and keep Apache-2.0 visible.

- [ ] **Step 6: Run final verification**

Run: `python -m pytest -q`

Run: `python -m cutset.cli --help`

Run: `git diff --check`

Run the live scenario once more and save the final transcript under `../submission/evidence/`.

- [ ] **Step 7: Commit**

```bash
git add .github examples README.md docs
git commit -m "feat: ship the verified Cutset pull request workflow"
```
