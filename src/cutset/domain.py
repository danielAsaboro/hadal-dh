from dataclasses import dataclass
from enum import Enum


@dataclass(frozen=True, slots=True)
class ColumnRename:
    model_name: str
    old_name: str
    new_name: str
    source_path: str


@dataclass(frozen=True, slots=True)
class AssetRef:
    urn: str
    asset_type: str
    name: str


@dataclass(frozen=True, slots=True)
class LineagePath:
    source: AssetRef
    downstream: AssetRef
    column: str
    degree: str = "1"
    downstream_columns: tuple[str, ...] = ()
    nodes: tuple[AssetRef, ...] = ()


@dataclass(frozen=True, slots=True)
class UsageQuery:
    urn: str
    source: str
    language: str
    name: str | None
    statement: str
    subjects: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AssertionSignal:
    urn: str
    assertion_type: str
    column: str | None
    status: str


@dataclass(frozen=True, slots=True)
class QualitySummary:
    total: int = 0
    failing: int = 0
    errors: int = 0
    sample: tuple[AssertionSignal, ...] = ()


@dataclass(frozen=True, slots=True)
class AssetContext:
    asset: AssetRef
    owners: tuple[AssetRef, ...] = ()
    tags: tuple[AssetRef, ...] = ()
    glossary_terms: tuple[AssetRef, ...] = ()
    incident_statuses: tuple[str, ...] = ()
    query_total: int = 0
    queries: tuple[UsageQuery, ...] = ()
    quality: QualitySummary = QualitySummary()
    complete: bool = True


@dataclass(frozen=True, slots=True)
class ImpactEvidence:
    source: AssetRef
    lineage_paths: tuple[LineagePath, ...]
    complete: bool
    change: ColumnRename | None = None
    schema_fields: tuple[str, ...] = ()
    asset_contexts: tuple[AssetContext, ...] = ()


class Severity(str, Enum):
    INFO = "info"
    HIGH = "high"
    CRITICAL = "critical"
    BLOCKED = "blocked"


class ReasonCode(str, Enum):
    CONTEXT_INCOMPLETE = "context_incomplete"
    NO_DOWNSTREAM_CONSUMERS = "no_downstream_consumers"
    DOWNSTREAM_COLUMN_CONSUMERS = "downstream_column_consumers"
    ML_ASSETS_AFFECTED = "ml_assets_affected"


@dataclass(frozen=True, slots=True)
class ImpactDecision:
    severity: Severity
    blocks_merge: bool
    reason: ReasonCode
