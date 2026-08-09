# Governed demo

`npm run demo` is the no-shortcuts end-to-end runner. It requires a real Git repository, DataHub MCP server, GitHub repository/pull request, authenticated owner, and validation command. Missing configuration or any failed reread stops the run.

```bash
export CUTSET_DATAHUB_MCP_COMMAND=/absolute/path/to/mcp-server-datahub
export DATAHUB_GMS_URL=http://127.0.0.1:8080
export TOOLS_IS_MUTATION_ENABLED=true
export DATA_QUALITY_TOOLS_ENABLED=true
export SAVE_DOCUMENT_TOOL_ENABLED=true
export SAVE_DOCUMENT_RESTRICT_UPDATES=false

export CUTSET_GITHUB_TOKEN=...
export CUTSET_GITHUB_REPOSITORY=owner/repository
export CUTSET_GITHUB_PULL_NUMBER=123

export CUTSET_DEMO_REPOSITORY_ROOT=/absolute/path/to/dbt-repository
export CUTSET_DEMO_BASE_REF=base-sha
export CUTSET_DEMO_HEAD_REF=head-sha
export CUTSET_DEMO_TARGET_URL=https://example.invalid/cutset/case
export CUTSET_DEMO_OWNER_MAPPINGS='[["urn:li:corpuser:data-owner","github-login"]]'
export CUTSET_DEMO_VALIDATION_COMMAND='["dbt","test","--select","customers+"]'

npm run demo
```

The runner plans and persists the case, writes owner mappings, creates/rereads GitHub work, generates and structurally validates compatibility artifacts, executes the configured command once per work item, verifies approvals as the authenticated mapped GitHub actor, publishes/rereads the deterministic commit status, and reruns both integrations to prove stable identities.

For the controlled local graph, first ingest `scripts/seed_demo_datahub.py` into a non-production DataHub instance. The final judged run must point at a real GitHub pull request whose head SHA exactly matches `CUTSET_DEMO_HEAD_REF`; Cutset intentionally refuses any mismatch.
