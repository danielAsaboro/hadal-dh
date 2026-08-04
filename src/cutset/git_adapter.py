import subprocess
from dataclasses import dataclass
from pathlib import Path


class GitContextError(RuntimeError):
    """Raised when Cutset cannot establish trustworthy Git context."""


@dataclass(frozen=True, slots=True)
class GitDiffRequest:
    repo: Path
    base: str
    head: str


def _run(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ["git", *args],
            cwd=repo,
            check=True,
            text=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise GitContextError("Git context command failed") from error


def _verify_repository(repo: Path) -> None:
    try:
        result = _run(repo, "rev-parse", "--is-inside-work-tree")
    except GitContextError as error:
        raise GitContextError(f"not a Git repository: {repo}") from error
    if result.stdout.strip() != "true":
        raise GitContextError(f"not a Git repository: {repo}")


def _verify_revision(repo: Path, revision: str) -> None:
    try:
        _run(
            repo,
            "rev-parse",
            "--verify",
            "--end-of-options",
            f"{revision}^{{commit}}",
        )
    except GitContextError as error:
        raise GitContextError(f"invalid Git revision: {revision}") from error


def read_git_diff(request: GitDiffRequest) -> str:
    """Return relevant dbt changes between two validated Git revisions."""
    _verify_repository(request.repo)
    _verify_revision(request.repo, request.base)
    _verify_revision(request.repo, request.head)
    result = _run(
        request.repo,
        "diff",
        "--unified=0",
        request.base,
        request.head,
        "--",
        "*.yml",
        "*.yaml",
        "*.sql",
    )
    if not result.stdout.strip():
        raise GitContextError("no dbt schema or SQL changes found")
    return result.stdout
