# Governed Change Coordination TypeScript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Cutset's governed graph-to-work-to-graph product as a TypeScript application with a React workspace, DataHub MCP context and write-back, real GitHub execution, SHA-bound approvals, executable validation, and deterministic admission.

**Architecture:** A single TypeScript workspace under `app/` owns domain contracts, CLI, API, connectors, and React UI. Pure Zod-validated domain functions compile DataHub MCP evidence and evaluate policy. Boundary adapters use the official MCP SDK, GitHub REST API, and real child processes; every remote mutation is reread and verified. The existing Python implementation remains untouched until the TypeScript replacement passes live parity.

**Tech Stack:** Node.js 24, TypeScript 5, npm workspaces, Zod, Commander, `@modelcontextprotocol/sdk`, Fastify, React, Vite, Vitest, Testing Library, Playwright, YAML, `node-sql-parser`, native `fetch`, Node `child_process` and `crypto`.

## Global Constraints

- All new product implementation is TypeScript.
- Preserve the verified Python/Agent Context Kit slice unchanged until stronger replacement proof.
- No mocks, placeholders, fake integrations, guessed identifiers, or simulated shipped success.
- Test HTTP/MCP fixtures mirror complete captured response shapes; judged proof uses real services.
- DataHub is the governed evidence source and institutional memory.
- Every case fact binds the exact revision and head SHA.
- Deterministic policy owns merge authority and fails closed.
- Every remote mutation requires exact reread verification.
- Secrets remain server-side and never enter cases, logs, HTML, issues, or DataHub.

---

### Task 1: TypeScript workspace and canonical case contract

**Files:**
- Create: `package.json`, `app/package.json`, `app/tsconfig.json`, `app/vitest.config.ts`
- Create: `app/src/domain/case.ts`, `app/src/domain/identity.ts`, `app/src/domain/serialization.ts`
- Test: `app/test/domain/case.test.ts`, `app/test/domain/serialization.test.ts`

**Interfaces:** Produces `ChangeCaseSchema`, readonly inferred types, `caseKey`, `revisionKey`, `workKey`, `serializeCase`, `parseCase`, and `caseContentHash`.

- [ ] Write failing tests proving stable identity, head/evidence revision invalidation, order-independent work keys, immutable readonly values, byte-stable round trips, unknown-version rejection, and tamper detection.
- [ ] Run `npm --workspace app test -- domain` and verify failure because modules do not exist.
- [ ] Implement SHA-256 identities using length-prefixed UTF-8 parts, Zod discriminated unions, schema version `1`, recursively sorted canonical JSON, and a hash excluding only `contentHash`.
- [ ] Run `npm --workspace app test -- domain` and `npm --workspace app run typecheck`; expect PASS.
- [ ] Run the untouched Python suite; expect 72 pass and two live skips.
- [ ] Commit `feat: add TypeScript change case contract`.

### Task 2: Real Git/dbt change detection

**Files:**
- Create: `app/src/git/repository.ts`, `app/src/git/dbt-change.ts`
- Test: `app/test/git/repository.test.ts`, `app/test/git/dbt-change.test.ts`

**Interfaces:** Produces `resolveRevision(repo, ref)`, `readDiff(repo, base, head)`, and `detectColumnRename(diff)`.

- [ ] Write failing tests that initialize real temporary Git repositories with `git`, create base/head commits, detect one exact dbt YAML rename, reject multiple/ambiguous changes, and reject nonexistent revisions.
- [ ] Verify RED.
- [ ] Implement with `execFile`, argument arrays, bounded output, path containment, YAML parsing, and exact add/remove matching.
- [ ] Verify targeted and full TypeScript tests, then commit `feat: detect real dbt changes in TypeScript`.

### Task 3: DataHub MCP client and evidence compiler

**Files:**
- Create: `app/src/datahub/mcp-client.ts`, `app/src/datahub/evidence.ts`, `app/src/datahub/normalize.ts`
- Test: `app/test/datahub/evidence.test.ts`
- Create: `app/test/integration/datahub-mcp.test.ts`

**Interfaces:** Produces `DataHubMcpClient.connect(config)`, `callTool(name, input)`, `collectEvidence(change, maxHops)`, and Zod `ImpactEvidenceSchema`.

- [ ] Write failing contract tests using full captured tool results for `search`, `get_entities`, `list_schema_fields`, `get_lineage`, `get_lineage_paths_between`, `get_dataset_queries`, and `get_dataset_assertions`.
- [ ] Assert exact single-asset resolution, old-column existence, bounded complete pagination, exact paths, owners, governance, redacted query literals, assertions/incidents, and ML assets; every incomplete response must fail closed.
- [ ] Verify RED.
- [ ] Implement the official MCP SDK client with explicit stdio or Streamable HTTP configuration. No production fixture transport or fallback evidence is allowed.
- [ ] Add a gated live test requiring real DataHub and MCP configuration; compare core results with the preserved Python proof dataset.
- [ ] Verify local tests and, when configured, live MCP tests. Commit `feat: collect governed evidence through DataHub MCP`.

### Task 4: Graph-derived cases and deterministic policy

**Files:**
- Create: `app/src/domain/compile-case.ts`, `app/src/domain/policy.ts`
- Test: `app/test/domain/compile-case.test.ts`, `app/test/domain/policy.test.ts`

**Interfaces:** Produces `compileCase(evidence, gitContext, existing?)`, `evaluateCase(case, observations)`, stable blocker codes, tasks, approvals, and state.

- [ ] Write failing tests for producer work, owner-grouped consumer work, ML validation, exact path retention, unowned blockers, owner mapping blockers, projection verification, task receipts, producer/consumer approvals, stale head, failed write-back, and allowed-only-with-zero-blockers.
- [ ] Verify RED.
- [ ] Implement deterministic compilation and policy; never choose among multiple owners or accept task closure as completion.
- [ ] Verify targeted/full tests and commit `feat: compile and govern change cases`.

### Task 5: DataHub case persistence and exact reread

**Files:**
- Create: `app/src/datahub/case-store.ts`, `app/src/domain/case-document.ts`
- Test: `app/test/datahub/case-store.test.ts`
- Extend: `app/test/integration/datahub-mcp.test.ts`

**Interfaces:** Produces `findCase`, `loadCase`, and `saveAndVerifyCase`.

- [ ] Write failing tests for exact title/key matching, incomplete search, duplicates, related-asset restriction, mutation failure, reread failure, and case/revision/hash mismatch.
- [ ] Verify RED.
- [ ] Encode a human summary plus delimited canonical JSON in one stable DataHub Analysis document. Use MCP tools for search/save/get and verify the reread document before success.
- [ ] Live-test two saves resolving to the same document URN and latest revision.
- [ ] Verify and commit `feat: persist verified cases to DataHub`.

### Task 6: Real GitHub connector

**Files:**
- Create: `app/src/github/api.ts`, `app/src/github/connector.ts`, `app/src/github/markers.ts`
- Test: `app/test/github/connector.test.ts`
- Create: `app/test/integration/github.test.ts`

**Interfaces:** Produces `preflightCase`, `syncWork`, `reconcileWork`, `verifyActor`, and `publishAndVerifyStatus`.

- [ ] Write failing boundary tests against an in-process HTTP contract server for PR head mismatch, owner mapping, assignee eligibility, pagination, exact hidden markers, duplicates, create/update/reread, `/user`, collaborator permission, commit-status publication, and combined-status reread.
- [ ] Verify RED.
- [ ] Implement native-fetch requests with API version headers, server-side bearer token, same-origin pagination, exact markers, complete preflight before mutation, and redacted errors.
- [ ] Add gated live GitHub test using an isolated real repository/PR and deterministic integration work key; rerun without duplicate issues.
- [ ] Verify and commit `feat: synchronize real GitHub work`.

### Task 7: Approvals, generated remediation, and executable receipts

**Files:**
- Create: `app/src/actions/approval.ts`, `app/src/remediation/generate.ts`, `app/src/remediation/validate.ts`, `app/src/validation/runner.ts`
- Test: `app/test/actions/approval.test.ts`, `app/test/remediation/validate.test.ts`, `app/test/validation/runner.test.ts`

**Interfaces:** Produces `recordApproval`, `generateCompatibilityMigration`, `validateRemediation`, and `runValidation`.

- [ ] Write failing tests for verified actor/owner/role/revision binding, conflicting decisions, SQL old-to-new alias, dbt YAML tests, unseen columns, real command execution, timeout/nonzero results, artifact containment/hashes, and stale artifact rejection.
- [ ] Verify RED.
- [ ] Implement deterministic compatibility output first; optional LLM drafting must validate against the same evidence and can never bypass structural or executed validators.
- [ ] Use `spawn`/`execFile` with `shell:false`, bounded output, timeout, SHA-256 receipts, and actual configured dbt commands.
- [ ] Verify and commit `feat: verify approvals and remediation receipts`.

### Task 8: Resumable services and CLI

**Files:**
- Create: `app/src/application/cases.ts`, `app/src/cli.ts`, `app/src/config.ts`
- Test: `app/test/application/cases.test.ts`, `app/test/cli.test.ts`

**Interfaces:** Produces `plan`, `syncGitHub`, `approve`, `validate`, `reconcile`, `decide`, `show`, and Commander commands.

- [ ] Write failing service tests using real temporary Git and explicit boundary ports. Assert artifacts precede mutation, incomplete context prevents mutation, partial failures block, each transition persists/rereads, and new head creates a stale prior revision.
- [ ] Verify RED.
- [ ] Implement load -> preflight -> action -> policy -> DataHub save/reread -> atomic local replica for every transition.
- [ ] Add CLI commands with secrets from environment only and stable nonzero exits for input, context, external, validation, write-back, and admission failures.
- [ ] Verify and commit `feat: orchestrate resumable change cases`.

### Task 9: Fastify API and React coordination workspace

**Files:**
- Create: `app/src/server/app.ts`, `app/src/server/routes/*.ts`
- Create: `app/src/ui/main.tsx`, `app/src/ui/App.tsx`, `app/src/ui/components/*.tsx`, `app/src/ui/styles.css`
- Test: `app/test/server/api.test.ts`, `app/test/ui/workspace.test.tsx`
- Create: `app/e2e/workspace.spec.ts`

**Interfaces:** Produces GET case/index/evidence routes and verified POST sync/approve/validate/decide routes. UI consumes only returned canonical cases.

- [ ] Write failing API tests for case loading, exact current revision, server-side actor verification, stale rejection, and no secret exposure.
- [ ] Write failing UI tests for blockers, lineage paths, owner work, approvals, remediation, receipts, external links, timeline, responsive navigation, accessible names, and no unverified success language.
- [ ] Verify RED.
- [ ] Implement Fastify services and a distinctive React workspace. Mutations return only DataHub-reread cases; loading/error/blocked states are explicit.
- [ ] Add Playwright flow covering plan display, task sync, verified approval, validation, and admission transitions against configured real services for judged proof.
- [ ] Verify and commit `feat: add Cutset coordination workspace`.

### Task 10: Real end-to-end proof, migration, and submission

**Files:**
- Create: `app/scripts/governed-demo.ts`, `docs/governed-demo.md`, real `examples/change-case.*`
- Modify: `README.md`, `.env.example`, `.github/workflows/cutset.yml`, `docs/architecture.md`, `docs/verification.md`
- Parent-private: `submission/submission-copy.md`, `submission/demo-script.md`, `submission/api-feedback.md`, `submission/final-requirements-audit.md`

- [ ] Run a real dbt diff through the TypeScript Git parser and DataHub MCP evidence path.
- [ ] Persist/reread the blocked case, create/reread real GitHub work, and publish/reread blocked status.
- [ ] Generate real artifacts, run configured validators, verify GitHub actor approvals, decide, persist/reread DataHub, publish/reread success.
- [ ] Rerun and prove the same DataHub document and GitHub issues update without duplication.
- [ ] Compare required evidence and outputs with the preserved Python slice; only then retire Python from the primary README path.
- [ ] Record sanitized real examples and exact proof; no expected or fabricated output.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, Playwright, the preserved Python suite, live integrations, and `git diff --check`.
- [ ] Complete every hackathon requirement, public repo/license/setup, under-three-minute video, and feedback artifact.
- [ ] Commit `docs: ship governed coordination submission`.
