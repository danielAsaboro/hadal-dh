# Cutset

> Turn DataHub graph evidence into coordinated, accountable work—and write every decision and outcome back to the graph.

A dbt column rename can cross team boundaries before anyone sees the breakage. Cutset detects the real Git change, resolves the model in DataHub, follows exact column and multi-hop lineage, and compiles one durable change case. That case drives owner-specific GitHub work, SHA-bound approvals, generated compatibility artifacts, executable validation receipts, and a deterministic merge status.

DataHub is the governed source of truth. GitHub is an execution surface. An LLM never decides whether a change may merge.

## Demonstrated vertical slice

The current TypeScript slice handles one intentionally narrow but complete change type: an unsafe dbt column rename.

```text
real Git base/head
  → exact dbt rename
  → DataHub schema + column lineage + dataset→DataJob→ML path
  → owner-grouped work and producer/consumer approvals
  → compatibility SQL/YAML
  → structural checks + real command receipts
  → deterministic blockers/admission
  → one idempotent DataHub Analysis document
```

The local proof resolved `customers.email → email_address`, retained the exact four-node path to `churn_prediction_v2`, produced three owner work items and two approval requirements, ran three artifact-hashed validation receipts, and updated one reread-verified DataHub document. See the [real governed case](examples/governed-change-case.md) and [generated remediation](examples/governed-remediation/customers_compatibility.sql).

GitHub synchronization is implemented against the real REST API and contract-tested through HTTP. The live GitHub test is credential-gated and fails closed; it is not represented as verified until run with a valid repository, pull request, and token.

## Why this is not a catalog chatbot

- Git SHAs, DataHub URNs, exact lineage paths, work keys, approvals, receipts, and the final decision stay bound in one canonical case.
- Missing context, ownership, mappings, task projections, approvals, validation, or DataHub reread verification blocks admission.
- Reruns update the same stable DataHub document and GitHub issues instead of creating duplicates.
- DataHub assertions are consumed when the connected MCP server exposes them. The official v0.6.0 server marks that tool Cloud-only; OSS capability absence is recorded rather than invented.
- Query literals are redacted before evidence enters the case.

## Install

Requirements: Node.js 24, npm, Git, a real DataHub OSS/Core or Cloud instance, and the official DataHub MCP server.

```bash
npm ci
python3.13 -m venv .mcp-venv
.mcp-venv/bin/pip install 'git+https://github.com/acryldata/mcp-server-datahub.git@v0.6.0'
cp .env.example .env
```

Set the absolute MCP command path and DataHub connection in `.env`. Then:

```bash
set -a; source .env; set +a
npm run cli -- case plan \
  --repo /path/to/real-dbt-repo \
  --repository owner/repository \
  --base BASE_SHA \
  --head HEAD_SHA
```

Continue with `case map-owner`, `sync-github`, `generate`, `validate`, `approve`, `reconcile`, and `decide`. Run `npm run cli -- case --help` for exact arguments. Every integration is explicit; there is no fallback transport or simulated success path.

The coordination workspace is served with:

```bash
npm run build
npm run serve
```

## Verification

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

The preserved Python vertical slice remains available for comparison and is not the primary product path. Live setup, integration gates, and proof boundaries are documented in [docs/verification.md](docs/verification.md); architecture and trust boundaries are in [docs/architecture.md](docs/architecture.md).

The repository began from DataHub's official Agent Starter; provenance is recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Licensed under Apache 2.0.
