# ChangeMarshal

> Turn DataHub graph evidence into coordinated, accountable work—and write every decision and outcome back to the graph.

A dbt column rename can cross team boundaries before anyone sees the breakage. ChangeMarshal detects the real Git change, resolves the model in DataHub, follows exact column and multi-hop lineage, and compiles one durable change case. That case drives owner-specific GitHub work, SHA-bound approvals, generated compatibility artifacts, executable validation receipts, and a deterministic merge status.

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
npm run changemarshal -- case plan \
  --repo /path/to/real-dbt-repo \
  --repository owner/repository \
  --base BASE_SHA \
  --head HEAD_SHA
```

Continue with `case map-owner`, `sync-github`, `generate`, `validate`, `reconcile`, and `decide`. `sync-github` creates or updates owner issues and requests the mapped producer and consumer as real pull-request reviewers. After those users submit reviews on the analyzed head SHA, `reconcile` rereads the review IDs, authors, states, commit IDs, URLs, and repository permissions into the canonical case. The optional `case brief` command uses AI SDK 7 with an explicitly configured real OpenAI-compatible model to summarize the already verified plan; its schema rejects invented URNs, omitted work, or the wrong case revision, and its output has no merge authority. Run `npm run changemarshal -- case --help` for exact arguments. Every integration is explicit; there is no fallback transport or simulated success path.

The coordination workspace uses React Flow for a keyboard-focusable, pannable and zoomable lifecycle map. Dagre gives every case a deterministic initial layout; users may then drag nodes to inspect dense paths without changing canonical evidence or policy. Selecting a stage opens its exact case, Git, DataHub and policy facts.

Build and serve it with:

```bash
npm run build
npm run serve
```

## Approval-gated AI SDK 7 agent

`changemarshal agent` runs a real Vercel AI SDK 7 `ToolLoopAgent` through QVAC's official AI SDK provider. Managed mode defaults to the tool-capable `qwen3.5-4b` model proven by the live browser flow; external mode attaches to an explicitly configured QVAC OpenAI-compatible endpoint. The fixed runtime scope supplies the repository, Git refs, owner mappings, validator argument array, artifact paths, and status URL; the model cannot replace them. Read-only Git/DataHub inspection may run directly. Planning/write-back, owner mapping, GitHub synchronization, remediation writes, validation commands, reconciliation, and status publication all emit AI SDK `user-approval` requests before execution.

```bash
npm run changemarshal -- agent \
  --repo /path/to/real-dbt-repo \
  --repository owner/change-marshal \
  --base BASE_SHA \
  --head HEAD_SHA \
  --target-url https://your-host/cases/current \
  --map urn:li:corpuser:data-owner=github-login \
  --validation-command-json '["dbt","test","--select","customers+"]' \
  --artifact .changemarshal/remediation/customers_compatibility.sql \
             .changemarshal/remediation/customers_compatibility.yml
```

The terminal uses `y`/`n` for each proposed mutation. The web command center exposes the same exact-argument, expiring, single-use approval gate. Before a run and again before continuation, its HTTP boundary re-resolves the configured base, head, and live checkout, rejecting a different case repository or any moved Git `HEAD`. Set `CHANGEMARSHAL_AGENT_ENABLED=1` plus every fixed-scope variable shown in `.env.example` to enable it; otherwise its health endpoint returns 503. Deterministic case policy alone computes merge admission. The GitHub mutation portion remains credential-gated and must not be treated as live-verified merely because its contract suite passes.

The repository-owned executable launcher invokes the official `@qvac/cli` and merges `app/qvac.config.json` into the provider-generated private config, raising the registry client's stalled-block timeout and retry limit for real multi-gigabyte downloads. On macOS, managed mode automatically selects a short temporary path when the inherited application temp path would exceed the native worker's Unix-socket limit. `qwen3.6-27b` remains an explicit alias, but it must pass this semantic check on the target hardware before being used or claimed:

```bash
CHANGEMARSHAL_QVAC_CONTEXT_SIZE=4096 \
  npm --workspace app exec -- tsx scripts/qvac-smoke.mts
```

## Verification

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

The credential-gated integration suites are `npm run test:integration:datahub` and `npm run test:integration:github`; each skips unless its explicit live gate is enabled and fails closed once enabled. The preserved Python vertical slice remains available for comparison and is not the primary product path.

## Rename compatibility

`changemarshal` and `CHANGEMARSHAL_*` are canonical. The legacy `cutset` npm command and `CUTSET_*` variables remain deterministic migration aliases: equal old/new values are accepted, conflicting values fail, and a legacy-only value emits a migration warning. Exact legacy `.cutset` case and remediation files move to `.changemarshal`; conflicting dual files fail. Existing Cutset DataHub document titles/envelopes and GitHub issue markers are recognized and rewritten in place, preserving their document URNs, issue IDs, case keys, and audit history.

The repository began from DataHub's official Agent Starter; provenance is recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Licensed under Apache 2.0.
