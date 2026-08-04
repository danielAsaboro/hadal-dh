import re

from cutset.domain import ColumnRename


class UnsupportedChangeError(ValueError):
    """Raised when a diff is outside Cutset's supported vertical slice."""


_NEW_PATH = re.compile(r"^\+\+\+ b/(.+\.(?:ya?ml))$", re.MULTILINE)
_YAML_NAME = re.compile(r"^(?P<indent>[ \t]*)-\s+name:\s+(?P<name>[^\s#]+)")


def parse_column_rename(diff_text: str) -> ColumnRename:
    """Parse one unambiguous dbt YAML column rename from a unified diff."""
    removed: list[tuple[str, str | None]] = []
    added: list[tuple[str, str | None]] = []
    current_model: str | None = None
    in_columns = False

    for line in diff_text.splitlines():
        if not line or line.startswith(("+++", "---")) or line[0] not in " +-":
            continue
        prefix, content = line[0], line[1:]
        name_match = _YAML_NAME.match(content)
        indentation = len(content) - len(content.lstrip(" \t"))

        if prefix == " ":
            if name_match and indentation == 2:
                current_model = name_match.group("name")
                in_columns = False
            elif current_model is not None and indentation == 4 and content.strip() == "columns:":
                in_columns = True
            elif content.strip() and indentation <= 2 and not name_match:
                current_model = None
                in_columns = False
            continue

        if name_match and indentation >= 4:
            target = removed if prefix == "-" else added
            target.append((name_match.group("name"), current_model if in_columns else None))

    if len(removed) != 1 or len(added) != 1:
        raise UnsupportedChangeError(
            "expected exactly one removed and one added dbt column"
        )

    old_name, removed_model = removed[0]
    new_name, added_model = added[0]
    if removed_model is None or removed_model != added_model:
        raise UnsupportedChangeError(
            "could not identify exactly one containing dbt model for the column rename"
        )

    paths = _NEW_PATH.findall(diff_text)
    if len(paths) != 1:
        raise UnsupportedChangeError("expected exactly one changed dbt YAML file")

    source_path = paths[0]
    return ColumnRename(
        model_name=removed_model,
        old_name=old_name,
        new_name=new_name,
        source_path=source_path,
    )
