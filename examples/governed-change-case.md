# Real Hadal governed change case

This sanitized sample was produced by the TypeScript CLI on 2026-08-09 from a real Git repository, DataHub OSS v1.6.0, and official DataHub MCP server v0.6.0. It is intentionally blocked because the configured GitHub credential was invalid; no task or approval success is simulated.

## Identity

- Case: `fbe74aa76740cd72a09bc797`
- Revision: `0a2d9bc865ccbf226e0ec672`
- Git: `988c910f4aa17459fa733dbfdff751ab10dcd99f` → `4f508e2cc3eb62606eca106c146b429c74f14681`
- Change: `customers.email` → `customers.email_address`
- DataHub document: `urn:li:document:shared-30244242-13d2-4311-8fe4-9badfffebd53`
- DataHub reread verified: `true`

## Exact impact evidence

```text
customers.email
  → customer_features.email_hash

analytics.customers
  → analytics.customer_features
  → airflow/cutset-demo/train-churn
  → churn_prediction_v2
```

The source carried one owner, a customer-data tag, the Customer Identity glossary term, incident health, and one DataHub usage query. The SQL literal was redacted before persistence. The downstream dataset and ML model were reread with explicit graph ownership.

The connected OSS MCP server did not advertise `get_dataset_assertions`; the case recorded `datasetAssertions: false` rather than inventing assertion results.

## Executable work plan

| Work key | Kind | Affected graph object | Validation |
| --- | --- | --- | --- |
| `98e13e597f131a54f94848a1` | producer migration | `analytics.customers` | exit 0, artifact hashes recorded |
| `343169f7aaf5bf9824dba496` | consumer remediation | `analytics.customer_features` | exit 0, artifact hashes recorded |
| `b22967ac15a592da4eea5641` | ML validation | `churn_prediction_v2` | exit 0, artifact hashes recorded |

Producer and consumer approval requirements were derived separately. All three items map the preserved legacy graph identity `urn:li:corpuser:cutset-demo` to the explicitly configured GitHub login `danielAsaboro`. That existing URN is evidence, not current product branding, and is deliberately not rewritten.

## Current deterministic decision

Admission: **blocked**.

```text
APPROVAL_MISSING:4f1f81a71ffbb166e8448f5e
APPROVAL_MISSING:a5f4cfb99e1d38698bc688b1
PROJECTION_MISSING:343169f7aaf5bf9824dba496
PROJECTION_MISSING:98e13e597f131a54f94848a1
PROJECTION_MISSING:b22967ac15a592da4eea5641
```

The missing GitHub projections and actor-verified approvals remain blockers. This is the expected fail-closed result until the real external execution surface is available.
