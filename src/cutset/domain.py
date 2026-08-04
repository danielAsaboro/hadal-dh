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


@dataclass(frozen=True, slots=True)
class ImpactEvidence:
    source: AssetRef
    lineage_paths: tuple[LineagePath, ...]
    complete: bool


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
