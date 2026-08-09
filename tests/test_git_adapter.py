import subprocess
from pathlib import Path

import pytest

from cutset.git_adapter import (
    GitContextError,
    GitDiffRequest,
    read_git_diff,
    resolve_git_revision,
)


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()


def _commit(repo: Path, message: str) -> None:
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", message)


def _initialize_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "warehouse"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "config", "user.name", "ChangeMarshal Test")
    _git(repo, "config", "user.email", "changemarshal@example.invalid")
    models = repo / "models"
    models.mkdir()
    schema = models / "customers.yml"
    schema.write_text("models:\n  - name: customers\n    columns:\n      - name: email\n")
    _commit(repo, "add customer schema")
    schema.write_text(
        "models:\n  - name: customers\n    columns:\n      - name: email_address\n"
    )
    _commit(repo, "rename customer email")
    return repo


def test_reads_diff_between_real_commits(tmp_path: Path) -> None:
    repo = _initialize_repo(tmp_path)

    diff = read_git_diff(GitDiffRequest(repo, "HEAD~1", "HEAD"))

    assert "-      - name: email" in diff
    assert "+      - name: email_address" in diff


def test_rejects_an_invalid_revision(tmp_path: Path) -> None:
    repo = _initialize_repo(tmp_path)

    with pytest.raises(GitContextError, match="missing-base"):
        read_git_diff(GitDiffRequest(repo, "missing-base", "HEAD"))


def test_rejects_an_empty_relevant_diff(tmp_path: Path) -> None:
    repo = _initialize_repo(tmp_path)

    with pytest.raises(GitContextError, match="no dbt schema or SQL changes found"):
        read_git_diff(GitDiffRequest(repo, "HEAD", "HEAD"))


def test_rejects_a_non_repository(tmp_path: Path) -> None:
    with pytest.raises(GitContextError, match="not a Git repository"):
        read_git_diff(GitDiffRequest(tmp_path, "HEAD~1", "HEAD"))


def test_resolves_symbolic_revision_to_commit_sha(tmp_path: Path) -> None:
    repo = _initialize_repo(tmp_path)

    resolved = resolve_git_revision(repo, "HEAD")

    assert len(resolved) == 40
    assert resolved == _git(repo, "rev-parse", "HEAD")
