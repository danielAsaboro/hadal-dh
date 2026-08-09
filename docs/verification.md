# Verification

## Local deterministic suite

```bash
npm ci
npm test
npm run typecheck
npm run build
git diff --check
```

Tests use real temporary Git repositories, real child processes, and an in-process HTTP contract server. The two network integration files are skipped unless real credentials are explicitly configured. The preserved Python slice remains independently verifiable with `.venv/bin/pytest -q`.

## Official DataHub MCP live test

Install the official server and configure a real DataHub instance:

```bash
python3.13 -m venv .mcp-venv
.mcp-venv/bin/pip install 'git+https://github.com/acryldata/mcp-server-datahub.git@v0.6.0'
export CUTSET_DATAHUB_MCP_COMMAND="$PWD/.mcp-venv/bin/mcp-server-datahub"
export DATAHUB_GMS_URL=http://127.0.0.1:8080
export TOOLS_IS_MUTATION_ENABLED=true
export DATA_QUALITY_TOOLS_ENABLED=true
export SAVE_DOCUMENT_TOOL_ENABLED=true
export SAVE_DOCUMENT_RESTRICT_UPDATES=false
export CUTSET_INTEGRATION_MODEL=customers
export CUTSET_INTEGRATION_OLD_COLUMN=email
export CUTSET_INTEGRATION_NEW_COLUMN=email_address
export CUTSET_INTEGRATION_DATASET_URN='urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)'
npm --workspace app test -- integration/datahub-mcp.test.ts
```

Set `CUTSET_INTEGRATION_WRITEBACK=1` and `CUTSET_INTEGRATION_GIT_REPOSITORY` to additionally prove two saves resolve to the same reread-verified DataHub document and content hash.

The controlled graph can be ingested into a local non-production DataHub instance with the preserved seed utility:

```bash
DATAHUB_GMS_URL=http://127.0.0.1:8080 .venv/bin/python scripts/seed_demo_datahub.py
```

## Real GitHub live test

Use an isolated repository and pull request. The token must be allowed to read the PR and collaborators, create/update issues, and create commit statuses.

```bash
export CUTSET_GITHUB_TOKEN=...
export CUTSET_GITHUB_REPOSITORY=owner/repository
export CUTSET_GITHUB_PULL_NUMBER=123
export CUTSET_GITHUB_ASSIGNEE=login
npm --workspace app test -- integration/github.test.ts
```

The test creates or updates one marker-bound issue, rereads it, reruns without duplication, verifies the authenticated actor and collaborator permission, publishes a commit status, and rereads the combined status. An invalid or absent credential is a hard blocker—not a skipped success claim.

## Verified local proof on 2026-08-09

The TypeScript CLI ran against a real two-commit dbt repository and DataHub OSS v1.6.0 through official MCP server v0.6.0. It proved:

- exact Git SHAs `988c910…` → `4f508e2…` and `customers.email → email_address`;
- real schema, redacted usage SQL, ownership, tags, glossary term, incident health, column lineage, and a four-node dataset→dataset→DataJob→MLModel path;
- three graph-derived work items, two approval requirements, and three successful artifact-hashed command receipts;
- one stable DataHub document URN, updated and reread with a verified canonical hash;
- fail-closed blockers for missing GitHub task projections and approvals.

The sanitized result is [examples/governed-change-case.md](../examples/governed-change-case.md). Private raw transcripts remain outside the public repository under the parent workspace.
