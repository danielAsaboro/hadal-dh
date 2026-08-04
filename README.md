# Cutset

> Know what breaks before you merge.

A dbt column rename looks harmless in a pull request. The downstream dashboard, feature, or production model it breaks is usually invisible there. Cutset is an impact-aware PR guardian that reads DataHub before merge, traces the changed column through lineage, and returns an auditable verdict with a validated compatibility patch.

## The 60-second demo

1. Rename `customers.email` to `customers.email_address` in dbt.
2. Run Cutset between the PR base and head revisions.
3. Cutset resolves `customers` through DataHub search, confirms `email` in the catalog schema, and traces downstream column lineage.
4. A downstream `mlModel` produces `critical / ml_assets_affected`, a blocking exit code, JSON/Markdown evidence, and a review-only compatibility alias.
5. With `--write-back`, Cutset saves the analysis in DataHub and tags only assets returned by the current graph read.

See the [verified live run](examples/sample-run.md), [live impact report](examples/impact-report.md), and [architecture](docs/architecture.md).

## Why DataHub is essential

Cutset does not grep for table names and call that lineage. It uses the DataHub Agent Context Kit to:

- search for the changed model instead of guessing a URN;
- verify the old field against the catalog schema;
- trace column-level downstream lineage through three hops;
- retrieve the exact intermediate path for every affected target;
- distinguish ordinary dataset consumers from ML features and models;
- save an idempotent impact document and apply an existing risk tag.

Missing or truncated metadata blocks the check. An LLM can draft a remediation, but deterministic policy owns merge safety and deterministic validators reject ungrounded code.

## Quickstart

Cutset supports Python 3.11–3.13. Python 3.14 is intentionally excluded because the pinned DataHub stack currently includes a native dependency without 3.14 support.

```bash
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env
```

Set `DATAHUB_GMS_URL` and `DATAHUB_GMS_TOKEN`, then run:

```bash
cutset review \
  --repo /path/to/dbt-repo \
  --base BASE_SHA \
  --head HEAD_SHA \
  --repository-id owner/repo \
  --output cutset-output
```

Use `--write-back --tag-name cutset-at-risk` only after creating that tag in a test DataHub instance. Cutset never creates or guesses governance URNs.

## Stable exit codes

| Code | Meaning |
| ---: | --- |
| `0` | Verified and non-blocking |
| `2` | Unsupported or invalid Git/dbt input |
| `3` | Missing or incomplete DataHub context |
| `4` | Verified unsafe downstream impact |
| `5` | Generated remediation failed validation |
| `6` | DataHub write-back failed or was partial |

## Development and proof

- [Verification guide](docs/verification.md)
- [Design specification](docs/superpowers/specs/2026-08-04-cutset-design.md)
- [Implementation plan](docs/superpowers/plans/2026-08-04-cutset-vertical-slice.md)
- [GitHub Actions workflow](.github/workflows/cutset.yml)

The workflow requires a protected GitHub environment named `datahub-review`. It installs the trusted base-commit version of Cutset and treats the PR checkout only as data, so PR-controlled Python never receives DataHub credentials.

```bash
pytest -q
python -m cutset.cli --help
git diff --check
```

The repository started from DataHub's official Agent Starter. The original `agent.py` and `goal.py` remain as provenance/reference; the shipped Cutset package lives under `src/cutset/`. Starter attribution is preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
