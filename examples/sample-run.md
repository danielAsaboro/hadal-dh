# Verified live run

This transcript was produced on 2026-08-04 against the official DataHub `v1.6.0`
Docker quickstart on ARM64. The graph was created with
`scripts/seed_demo_datahub.py`; no Agent Context response was mocked.

## Scenario

A two-commit dbt repository renames `customers.email` to
`customers.email_address`. DataHub contains this controlled dependency chain:

```text
analytics.customers.email
  -> analytics.customer_features.email_hash
  -> Airflow train-churn job
  -> MLflow churn_prediction_v2 model
```

## Command

```bash
DATAHUB_GMS_URL=http://localhost:8080 cutset review \
  --repo /path/to/live-demo-repo \
  --base 988c910 \
  --head 4f508e2 \
  --repository-id cutset/live-demo \
  --output cutset-output \
  --write-back \
  --tag-name cutset-at-risk
```

## Result

- Verdict: `BLOCK`
- Severity: `critical`
- Reason: `ml_assets_affected`
- Context complete: `true`
- Exit code: `4`
- Analysis key: `6de99d594317f8d18474`
- Remediation validation: `VALID`

The report preserved both the exact field path
`email -> email_hash` and the exact entity path through the training job to the
ML model. DataHub saved one related impact document and applied the existing
`cutset-at-risk` tag to the affected datasets and model.

The identical command was then run a second time. Both JSON reports had SHA-256
`ed5ecc563fe23946b756d67c92cc1b3d1c4a75549f586c8c9191e3a4fadff137`, and
both Markdown reports had SHA-256
`4d40c231f5ea5479965c5fe6f70692940c2424d70765a9f954191f43b17a1f38`.
The second write updated the same DataHub document rather than creating another.
