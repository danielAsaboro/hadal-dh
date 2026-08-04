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

## Ranked impact

- `churn_prediction_v2` — score `105` — ml_asset, missing_owner
- `Customer Features` — score `45` — column_mapping, missing_owner

## DataHub context

### Customers

- Owners: urn:li:corpuser:cutset-demo
- Tags: Customer Data, Cutset: At Risk
- Glossary terms: Customer Identity
- Usage queries: `1`
- Quality: `0` failing, `0` errors
- Incident statuses: PASS
- Context complete: `true`

### Customer Features

- Owners: unowned
- Tags: Cutset: At Risk
- Glossary terms: none
- Usage queries: `0`
- Quality: `0` failing, `0` errors
- Incident statuses: PASS
- Context complete: `true`

### churn_prediction_v2

- Owners: unowned
- Tags: Cutset: At Risk
- Glossary terms: none
- Usage queries: `0`
- Quality: `0` failing, `0` errors
- Incident statuses: none
- Context complete: `true`


## Suggested compatibility patch: VALID

- Grounding: `query_grounded`
- Supporting query: `urn:li:query:cutset-customer-feature-extraction`

```sql
select email as email_address from analytics.customers
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
