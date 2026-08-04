# Verification

## Automated checks

```bash
python3.13 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/python -m pytest -q
.venv/bin/python -m cutset.cli --help
git diff --check
```

The normal suite uses real temporary Git repositories and sanitized Agent Context Kit response shapes. Only the DataHub network boundary is replaced in CLI tests.

## Live DataHub proof

Configure a non-production DataHub instance and an existing `cutset-at-risk` tag:

```bash
cp .env.example .env
set -a; source .env; set +a
.venv/bin/python -m pytest tests/integration/test_datahub_gateway.py -q -m integration
.venv/bin/cutset review \
  --repo /path/to/dbt-repo \
  --base BASE_SHA \
  --head HEAD_SHA \
  --repository-id owner/repo \
  --output cutset-output \
  --write-back \
  --tag-name cutset-at-risk
```

Verify all four artifacts before recording the demo:

1. `impact-report.json` and `impact-report.md` exist even when the verdict blocks.
2. The report source URN and downstream URNs match the DataHub API/UI.
3. DataHub contains a related `Analysis` document with the same Cutset analysis key.
4. A second identical run updates the same document instead of creating a duplicate.

The committed files under `examples/` are sanitized fixture-derived outputs until this checklist is run against the submission DataHub deployment. Private unsanitized transcripts belong in the parent workspace's `submission/evidence/`, never in this public repository.
