# Hadal

> Governed change intelligence for data systems.

A dbt column rename can cross team boundaries before anyone sees the breakage. Hadal traces the proposed change into the deepest reaches of the DataHub dependency graph, surfaces downstream risk, coordinates governed remediation, and records the resolution in DataHub. **See every consequence before the change ships.**

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

## Verified DataHub resource coverage

The resource pass below was run against DataHub Core `v1.6.0`
(`059a36c0b035a6057de00114ccac0ea9003d6bc2`), not inferred from installed
packages. Raw tokens, runtime databases, and unsanitized logs remain in the
private submission workspace. The judge-readable official-dataset result is in
[`examples/official-datahub-scenario/`](examples/official-datahub-scenario/).

| Resource | Exact version | Real use and evidence | Status / limitation |
| --- | --- | --- | --- |
| DataHub Docs | Docs `1.6.0` | Supplied the primary-source procedures used for every command below. | **Verified guidance**; documentation alone is not runtime proof. |
| Quickstart | Core image `v1.6.0` | Backed the live OSS instance; `/config` and entity counts were reread. | **Verified** on the existing documented stack. |
| DataHub Core | `v1.6.0`, `059a36c0…` | Canonical graph for rename evidence, official datasets, lineage, governance, queries, and durable Documents. | **Verified**; Cloud-only capabilities remain unavailable. |
| DataHub MCP Server | `0.6.0` | Primary TypeScript lane read schema, owner, governance, query and multi-hop/ML context, then idempotently saved and reread one stable NYC analysis URN. | **Verified**; OSS advertised Documents but not dataset assertions. |
| Agent Context Kit | `1.6.0.17` | Python fallback read the official NYC schema, owner, governance and exact lineage, then updated and reread an isolated Document. | **Verified compatibility lane**; indexed search required bounded polling. |
| DataHub Skills | `1.4.1`, `f22f930…` | The `datahub-lineage` skill validated uncapped three-hop primary and two-hop NYC paths during development. | **Verified development-time use**, not shipped runtime integration. |
| Analytics Agent | `0.4.0`, `14efac0…` | A real read-only NYC run authenticated to DataHub and resolved the exact three URNs plus owner/tag/glossary context; it stalled before lineage, SQL, or synthesis. | **Blocked after partial live use**; the eight-minute run ended with a provider timeout, so no completed grounded answer is claimed. |
| `showcase-ecommerce` | datapack index v4; static-assets `dd5434b…` | Loaded with the official command, reread real URNs, and exposed a real pagination edge that produced a public regression fix. | **Verified**; Core filtered 247 unsupported aspects. |
| official built-in scenario | NYC path `edbfb6d…` | Loaded five real datasets plus official lineage/metadata; MCP and ACK reread the exact raw→staging→mart path. | **Verified**; the committed DB actually has a nine-day lag and no zero-load row, contrary to its README. |
| DataHub Community | `#agent-hackathon` | A technically focused reproduction is prepared. | **Pending action-time confirmation**; no post is claimed yet. |
| upstream contribution | static-assets base `dd5434b…` | A tested correction for the NYC scenario generator and exact PR text are prepared. | **Pending action-time confirmation**; no PR or maintainer response is claimed yet. |

Reproduce the two official imports from their primary-source directories:

```bash
datahub datapack load showcase-ecommerce
datahub ingest -c ingest_pipeline.yaml
python add_lineage.py --instance=nyc_taxi_pipeline
python add_metadata.py --instance=nyc_taxi_pipeline
```

The observed official NYC URNs, counts, dates, lineage, governance, MCP
capability flags, and stable write-back URN are in the sanitized
[`proof-summary.json`](examples/official-datahub-scenario/proof-summary.json).

### Using DataHub Skills with Hadal

DataHub Skills guide development and investigation; they are not a runtime
dependency of Hadal. Install the pinned official package in a private
agent workspace and invoke the lineage skill against a real URN:

```bash
npx skills add datahub-project/datahub-skills -a codex
datahub -C skill=datahub-lineage lineage \
  --urn "$SOURCE_URN" --direction downstream --hops 3 --count 100 --format json
```

Check both `capped` and the returned hop count before using the result. In the
verified pass this changed the investigation artifact by confirming the full
`customers → customer_features → train-churn → churn model` path and the
official NYC raw→staging→mart path were uncapped.

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

## Brand and compatibility notes

Hadal is the public product name. The repository slug, npm package/command
(`change-marshal` / `changemarshal`), `CHANGEMARSHAL_*` environment variables,
`.changemarshal` local replica path, DataHub document URNs, and GitHub HTML
markers intentionally remain stable so an existing case, integration, or audit
record continues to resolve. Hadal reads existing ChangeMarshal and Cutset
case documents and issue markers, then updates the same external records in
place when an operator reruns the real workflow. No domain or deployment URL
is claimed here until the owner confirms it.

## Approval-gated AI SDK 7 agent

The retained `changemarshal agent` command runs a real Vercel AI SDK 7 `ToolLoopAgent` through QVAC's official AI SDK provider. Managed mode defaults to the tool-capable `qwen3.6-27b` model with a 16,384-token context, verified on a 36 GB Apple-silicon host; smaller machines can explicitly select `qwen3.5-4b`. External mode attaches to an explicitly configured QVAC OpenAI-compatible endpoint. The Hadal command-center and CLI workflow fixes the plan to `readCase → generateRemediation`; callers cannot replace it. The runtime also binds every case-scoped tool argument to `--case-key` and verifies that case against the resolved repository, base, head, and live `HEAD` before model startup. The fixed scope supplies owner mappings, validator arguments, artifact paths, and status URL; the model cannot replace them. Every mutating tool remains configured as AI SDK `user-approval`, and deterministic policy alone owns merge authority.

```bash
npm run changemarshal -- agent \
  --repo /path/to/real-dbt-repo \
  --repository owner/change-marshal \
  --base BASE_SHA \
  --head HEAD_SHA \
  --case-key CASE_KEY \
  --target-url https://your-host/cases/current \
  --map urn:li:corpuser:data-owner=github-login \
  --validation-command-json '["dbt","test","--select","customers+"]' \
  --artifact .changemarshal/remediation/customers_compatibility.sql \
             .changemarshal/remediation/customers_compatibility.yml
```

The terminal uses `y`/`n` for each proposed mutation. The Hadal command center exposes the same exact-argument, expiring, single-use approval gate. Before a run and again before continuation, its HTTP boundary re-resolves the configured base, head, and live checkout, rejecting a different case repository or any moved Git `HEAD`. Token-free run events, denials, approvals, tool outcomes, and terminal answers are idempotently written into the same canonical DataHub case and reread before the UI presents them. Set the retained `CHANGEMARSHAL_AGENT_ENABLED=1` plus every fixed-scope variable shown in `.env.example` to enable it; otherwise its health endpoint returns 503. Deterministic case policy alone computes merge admission. The GitHub mutation portion remains credential-gated and must not be treated as live-verified merely because its contract suite passes.

The repository-owned executable launcher invokes the official `@qvac/cli` and merges `app/qvac.config.json` into the provider-generated private config, raising the registry client's stalled-block timeout and retry limit for real multi-gigabyte downloads. On macOS, managed mode automatically selects a short temporary path when the inherited application temp path would exceed the native worker's Unix-socket limit. Run the same semantic check on each target host before relying on its local model:

```bash
CHANGEMARSHAL_QVAC_CONTEXT_SIZE=16384 \
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

The retained `changemarshal` command and `CHANGEMARSHAL_*` configuration prefix remain stable compatibility identifiers. The older `cutset` npm command and `CUTSET_*` variables remain deterministic migration aliases: equal old/new values are accepted, conflicting values fail, and a legacy-only value emits a migration warning. Exact legacy `.cutset` case and remediation files move to `.changemarshal`; conflicting dual files fail. Existing ChangeMarshal and Cutset DataHub document titles/envelopes and GitHub issue markers are recognized and rewritten in place, preserving their document URNs, issue IDs, case keys, and audit history.

The repository began from DataHub's official Agent Starter; provenance is recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Licensed under Apache 2.0.
