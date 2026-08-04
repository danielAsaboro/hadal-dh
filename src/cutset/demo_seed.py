"""Deterministic metadata graph used by Cutset's live DataHub demo."""

from collections.abc import Sequence
from typing import Type

from datahub.metadata.schema_classes import (
    AuditStampClass,
    QueryPropertiesClass,
    QueryStatementClass,
    QuerySubjectsClass,
    QuerySubjectClass,
)
from datahub.metadata.urns import QueryUrn, SchemaFieldUrn
from datahub.sdk.dataflow import DataFlow
from datahub.sdk.datajob import DataJob
from datahub.sdk.dataset import Dataset
from datahub.sdk.entity import Entity
from datahub.sdk.glossary_node import GlossaryNode
from datahub.sdk.glossary_term import GlossaryTerm
from datahub.sdk.mlmodel import MLModel
from datahub.sdk.tag import Tag


class DemoQuery(Entity):
    """Minimal SDK query entity for a repeatable local usage signal."""

    __slots__ = ()

    @classmethod
    def get_urn_type(cls) -> Type[QueryUrn]:
        return QueryUrn

    def __init__(self, *, id: str, statement: str, subjects: Sequence[str]) -> None:
        super().__init__(QueryUrn(id=id))
        audit = AuditStampClass(time=0, actor="urn:li:corpuser:cutset-demo")
        self._set_aspect(
            QueryPropertiesClass(
                statement=QueryStatementClass(value=statement, language="SQL"),
                source="SYSTEM",
                name="Customer feature extraction",
                created=audit,
                lastModified=audit,
            )
        )
        self._set_aspect(
            QuerySubjectsClass(
                subjects=[QuerySubjectClass(entity=subject) for subject in subjects]
            )
        )


def build_demo_entities() -> Sequence[Entity]:
    """Build an idempotently upsertable dataset-to-model impact graph."""
    risk_tag = Tag(
        name="cutset-at-risk",
        display_name="Cutset: At Risk",
        description="Applied by Cutset when a proposed change threatens downstream assets.",
        color="#D97706",
    )
    customer_tag = Tag(
        name="customer-data",
        display_name="Customer Data",
        description="Customer-domain data used by production analytics.",
        color="#2563EB",
    )
    glossary_node = GlossaryNode(
        id="cutset-demo",
        display_name="Cutset Demo",
        definition="Business concepts used in Cutset's controlled live proof.",
    )
    customer_identity = GlossaryTerm(
        id="customer-identity",
        display_name="Customer Identity",
        definition="Fields that identify or contact a customer.",
        parent_node=glossary_node,
    )
    customers = Dataset(
        platform="snowflake",
        name="analytics.customers",
        display_name="Customers",
        description="Canonical customer records for the Cutset live demo.",
        schema=[
            ("customer_id", "VARCHAR", "Stable customer identifier."),
            ("email", "VARCHAR", "Customer email used by downstream features."),
        ],
        owners=["cutset-demo"],
        tags=[customer_tag.urn],
        terms=[customer_identity.urn],
    )
    customer_features = Dataset(
        platform="snowflake",
        name="analytics.customer_features",
        display_name="Customer Features",
        description="Feature table derived from canonical customer records.",
        schema=[
            ("customer_id", "VARCHAR", "Stable customer identifier."),
            ("email_hash", "VARCHAR", "Privacy-preserving email feature."),
        ],
        upstreams={customers.urn: {"email_hash": ["email"]}},
    )
    training_flow = DataFlow(
        platform="airflow",
        name="cutset-demo",
        display_name="Cutset Demo Training",
        description="Controlled training pipeline for Cutset's live proof.",
    )
    training_job = DataJob(
        name="train-churn",
        flow=training_flow,
        display_name="Train Churn Model",
        description="Trains churn_prediction_v2 from customer features.",
        inlets=[customer_features.urn],
    )
    churn_model = MLModel(
        id="churn_prediction_v2",
        platform="mlflow",
        name="Churn Prediction v2",
        description="Demo model that depends on the customer email feature path.",
        training_jobs=[training_job.urn],
    )
    usage_query = DemoQuery(
        id="cutset-customer-feature-extraction",
        statement=(
            "select customer_id, email from analytics.customers "
            "where region = 'NG'"
        ),
        subjects=(
            str(customers.urn),
            str(SchemaFieldUrn(customers.urn, "email")),
        ),
    )
    return (
        risk_tag,
        customer_tag,
        glossary_node,
        customer_identity,
        customers,
        customer_features,
        training_flow,
        training_job,
        churn_model,
        usage_query,
    )


def seed_demo(client: object) -> Sequence[str]:
    """Upsert the controlled demo graph through a DataHub SDK client."""
    entities_client = getattr(client, "entities")
    entities = build_demo_entities()
    for entity in entities:
        entities_client.upsert(entity)
    return tuple(str(entity.urn) for entity in entities)
