# Sample Run

> Actual output from `python agent.py` against the DataHub `healthcare` sample dataset
> (lightly trimmed). The agent reasons fresh each time, so wording varies run to run.

## Command

```bash
python agent.py
```

## What the agent reported

**Dataset flagged:** `urn:li:dataset:(urn:li:dataPlatform:sqlite,healthcare.main.v_billing_from_staging,PROD)`

**Investigation:**
- Searched all 7 healthcare datasets (`raw_patients` → `staging_patients` → 3 views → `mart_billing` / `mart_demographics`).
- Every *table* had an owning team (`clinical_team`, `research_team`, `finance_team`) — but the three intermediate *views* had **no owner** assigned.
- Focused on `v_billing_from_staging`: it duplicates financially-sensitive billing logic (`billing_amount` cast, `length_of_stay_days`) that also lives in `mart_billing`, yet has no owner and sits **outside** the tracked lineage to `mart_billing` (zero downstream consumers) — so it can silently drift out of sync while looking like part of the pipeline.

**Actions taken:**
1. Updated the description to document the missing owner and the orphaned/duplicate-logic risk.
2. Added the `needs-review` tag so it surfaces in governance queues.

**Why this one:** among the 7 assets, it combined *no owner* + *duplicated business-critical logic* + *orphaned lineage* — the highest-risk gap in the catalog.

## In the DataHub UI

After the run, `v_billing_from_staging` shows the new **`needs-review`** tag and the updated **description**.

This is the read → act → write-back loop: the agent read context, decided, acted, and wrote the result back — so the catalog is a little more trustworthy than before.
