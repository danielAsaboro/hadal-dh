import re
from pathlib import Path

from cutset.domain import ColumnRename


class UnsupportedChangeError(ValueError):
    """Raised when a diff is outside Cutset's supported vertical slice."""


_REMOVED_COLUMN = re.compile(r"^-\s+-\s+name:\s+([^\s#]+)\s*(?:#.*)?$", re.MULTILINE)
_ADDED_COLUMN = re.compile(r"^\+\s+-\s+name:\s+([^\s#]+)\s*(?:#.*)?$", re.MULTILINE)
_NEW_PATH = re.compile(r"^\+\+\+ b/(.+\.(?:ya?ml))$", re.MULTILINE)


def parse_column_rename(diff_text: str) -> ColumnRename:
    """Parse one unambiguous dbt YAML column rename from a unified diff."""
    removed = _REMOVED_COLUMN.findall(diff_text)
    added = _ADDED_COLUMN.findall(diff_text)
    if len(removed) != 1 or len(added) != 1:
        raise UnsupportedChangeError(
            "expected exactly one removed and one added dbt column"
        )

    paths = _NEW_PATH.findall(diff_text)
    if len(paths) != 1:
        raise UnsupportedChangeError("expected exactly one changed dbt YAML file")

    source_path = paths[0]
    return ColumnRename(
        model_name=Path(source_path).stem,
        old_name=removed[0],
        new_name=added[0],
        source_path=source_path,
    )
