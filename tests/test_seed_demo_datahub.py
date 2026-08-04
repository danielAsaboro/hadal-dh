from datahub.metadata.schema_classes import (
    DataJobInputOutputClass,
    MLModelPropertiesClass,
    SchemaMetadataClass,
    UpstreamLineageClass,
)

from cutset.demo_seed import build_demo_entities


def test_demo_entities_encode_dataset_column_and_model_training_lineage() -> None:
    entities = build_demo_entities()

    assert [str(entity.urn) for entity in entities] == [
        "urn:li:tag:cutset-at-risk",
        "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)",
        "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customer_features,PROD)",
        "urn:li:dataFlow:(airflow,cutset-demo,PROD)",
        "urn:li:dataJob:(urn:li:dataFlow:(airflow,cutset-demo,PROD),train-churn)",
        "urn:li:mlModel:(urn:li:dataPlatform:mlflow,churn_prediction_v2,PROD)",
    ]

    source, features, _flow, job, model = entities[1:]
    source_schema = source._get_aspect(SchemaMetadataClass)
    assert source_schema is not None
    assert [field.fieldPath for field in source_schema.fields] == ["customer_id", "email"]

    upstreams = features._get_aspect(UpstreamLineageClass)
    assert upstreams is not None
    assert upstreams.fineGrainedLineages is not None
    assert upstreams.fineGrainedLineages[0].upstreams == [
        f"urn:li:schemaField:({source.urn},email)"
    ]

    job_io = job._get_aspect(DataJobInputOutputClass)
    assert job_io is not None
    assert job_io.inputDatasets == [str(features.urn)]

    model_props = model._get_aspect(MLModelPropertiesClass)
    assert model_props is not None
    assert model_props.trainingJobs == [str(job.urn)]
