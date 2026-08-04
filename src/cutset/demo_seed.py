"""Deterministic metadata graph used by Cutset's live DataHub demo."""

from collections.abc import Sequence

from datahub.sdk.dataflow import DataFlow
from datahub.sdk.datajob import DataJob
from datahub.sdk.dataset import Dataset
from datahub.sdk.entity import Entity
from datahub.sdk.mlmodel import MLModel
from datahub.sdk.tag import Tag


def build_demo_entities() -> Sequence[Entity]:
    """Build an idempotently upsertable dataset-to-model impact graph."""
    risk_tag = Tag(
        name="cutset-at-risk",
        display_name="Cutset: At Risk",
        description="Applied by Cutset when a proposed change threatens downstream assets.",
        color="#D97706",
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
    return (
        risk_tag,
        customers,
        customer_features,
        training_flow,
        training_job,
        churn_model,
    )


def seed_demo(client: object) -> Sequence[str]:
    """Upsert the controlled demo graph through a DataHub SDK client."""
    entities_client = getattr(client, "entities")
    entities = build_demo_entities()
    for entity in entities:
        entities_client.upsert(entity)
    return tuple(str(entity.urn) for entity in entities)
