# Cutset impact review

> Sanitized fixture-derived example. Live DataHub verification is documented separately.

## Verdict: BLOCK

- Severity: `critical`
- Reason: `ml_assets_affected`
- Context complete: `true`
- Change: `customers.email` → `email_address`
- Source: `urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)`

## Downstream evidence

- `mlModel` — `urn:li:mlModel:churn_prediction_v2`

## Suggested compatibility patch: VALID

```sql
select email as email_address from upstream
```

CUTSET ANALYSIS KEY: `1d4d82709b61a9577412`
