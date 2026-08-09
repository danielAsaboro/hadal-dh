from datahub.metadata.schema_classes import (
    DataJobInputOutputClass,
    GlossaryTermsClass,
    MLModelPropertiesClass,
    OwnershipClass,
    QueryPropertiesClass,
    QuerySubjectsClass,
    SchemaMetadataClass,
    UpstreamLineageClass,
)

from cutset.demo_seed import build_demo_entities


def test_demo_entities_encode_dataset_column_and_model_training_lineage() -> None:
    entities = build_demo_entities()

    assert [str(entity.urn) for entity in entities] == [
        "urn:li:tag:cutset-at-risk",
        "urn:li:tag:customer-data",
        "urn:li:glossaryNode:cutset-demo",
        "urn:li:glossaryTerm:customer-identity",
        "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD)",
        "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customer_features,PROD)",
        "urn:li:dataFlow:(airflow,cutset-demo,PROD)",
        "urn:li:dataJob:(urn:li:dataFlow:(airflow,cutset-demo,PROD),train-churn)",
        "urn:li:mlModel:(urn:li:dataPlatform:mlflow,churn_prediction_v2,PROD)",
        "urn:li:query:cutset-customer-feature-extraction",
    ]

    source, features, _flow, job, model, query = entities[4:]
    source_schema = source._get_aspect(SchemaMetadataClass)
    assert source_schema is not None
    assert [field.fieldPath for field in source_schema.fields] == ["customer_id", "email"]
    ownership = source._get_aspect(OwnershipClass)
    assert ownership is not None
    assert ownership.owners[0].owner == "urn:li:corpuser:cutset-demo"
    terms = source._get_aspect(GlossaryTermsClass)
    assert terms is not None
    assert terms.terms[0].urn == "urn:li:glossaryTerm:customer-identity"

    upstreams = features._get_aspect(UpstreamLineageClass)
    assert upstreams is not None
    assert upstreams.fineGrainedLineages is not None
    assert upstreams.fineGrainedLineages[0].upstreams == [
        f"urn:li:schemaField:({source.urn},email)"
    ]
    assert features._get_aspect(OwnershipClass).owners[0].owner == "urn:li:corpuser:cutset-demo"

    job_io = job._get_aspect(DataJobInputOutputClass)
    assert job_io is not None
    assert job_io.inputDatasets == [str(features.urn)]

    model_props = model._get_aspect(MLModelPropertiesClass)
    assert model_props is not None
    assert model_props.trainingJobs == [str(job.urn)]
    assert model._get_aspect(OwnershipClass).owners[0].owner == "urn:li:corpuser:cutset-demo"

    query_properties = query._get_aspect(QueryPropertiesClass)
    assert query_properties is not None
    assert query_properties.source == "SYSTEM"
    assert "region = 'NG'" in query_properties.statement.value
    query_subjects = query._get_aspect(QuerySubjectsClass)
    assert query_subjects is not None
    assert [subject.entity for subject in query_subjects.subjects] == [
        str(source.urn),
        "urn:li:schemaField:(urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.customers,PROD),email)",
    ]
