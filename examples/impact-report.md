# Cutset impact review

## Verdict: BLOCK

- Severity: `critical`
- Reason: `ml_assets_affected`
- Context complete: `true`
- Change: `customers.email` → `email_address`
- Source: `urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)`

## Downstream evidence

- `dataset` — `urn:li:schemaField:(urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD),email)` → `urn:li:schemaField:(urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customer_features,PROD),email_hash)`
- `mlModel` — `urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)` → `urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customer_features,PROD)` → `urn:li:dataJob:(urn:li:dataFlow:(airflow,cutset-demo,PROD),train-churn)` → `urn:li:mlModel:(urn:li:dataPlatform:mlflow,churn_prediction_v2,PROD)`

## Suggested compatibility patch: VALID

```sql
select email as email_address from upstream
```

```yaml
version: 2
models:
  - name: customers
    columns:
      - name: email_address
        tests:
          - not_null
```

CUTSET ANALYSIS KEY: `6de99d594317f8d18474`
