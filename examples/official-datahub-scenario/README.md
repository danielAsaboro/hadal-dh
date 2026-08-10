# Official DataHub NYC Taxi scenario

This secondary demonstration used the official `datahub-project/static-assets`
NYC Taxi dataset at commit
`edbfb6dafd95fc401d90b104776eb790077c4478`. It does not replace
Hadal's primary unsafe dbt rename and ML-impact slice.

## Reproduce the metadata load

Run these commands from `datasets/nyc-taxi` in the official static-assets
repository against DataHub Core `v1.6.0`:

```bash
datahub ingest -c ingest_pipeline.yaml
python add_lineage.py --instance=nyc_taxi_pipeline
python add_metadata.py --instance=nyc_taxi_pipeline
```

The verified run used DataHub CLI `1.6.0.6`. The first ingestion attempt failed
closed because the SQLAlchemy source extra was absent. After installing the
documented extra, ingestion produced 40 events for three tables, two views, two
containers, and their aspects. The official scripts then added four lineage
relationships and attached the documented tags, glossary terms, and owner.

## What the official artifact actually contains

The source README describes a three-day raw-to-staging gap and one mart day with
`trip_count = 0`. Direct queries of the unchanged committed database returned:

| Stage | Rows | Minimum date | Maximum date |
| --- | ---: | --- | --- |
| `raw_trips` | 250,000 | 2015-01-01 | 2016-03-10 |
| `staging_trips` | 208,675 | 2015-01-01 | 2016-03-01 |
| `mart_daily_summary` | 41 daily rows | 2015-01-01 | 2016-03-01 |

`mart_daily_summary` contained zero rows where `trip_count = 0`. Hadal
therefore records the nine-day observed gap and the missing planted empty-load
row as evidence discrepancies. It does not rewrite them into the intended
answer.

## Hadal evidence result

The official MCP server `0.6.0` resolved all five
`nyc_taxi_pipeline` datasets, returned all 19 fields for `raw_trips`, returned
the official owner and governance associations, and verified one exact
raw-to-staging-to-mart path. The dataset has no DataHub query entities; the MCP
result reported `total: 0` rather than inventing query context.

Hadal wrote this scoped analysis to
`urn:li:document:changemarshal-official-nyc-taxi-resource-coverage-v1`, reread
its exact marker, saved it again at the same URN, and reread it again. See the
[sanitized proof summary](proof-summary.json). Raw protocol output and logs are
kept outside the public repository because they are submission evidence.
