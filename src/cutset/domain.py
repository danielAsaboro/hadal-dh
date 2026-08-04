from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ColumnRename:
    model_name: str
    old_name: str
    new_name: str
    source_path: str

