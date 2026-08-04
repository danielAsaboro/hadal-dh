import subprocess
from pathlib import Path

from typer.testing import CliRunner

from cutset.cli import app
from cutset.datahub_gateway import DataHubWriteBackError
from cutset.domain import AssetRef, ImpactEvidence, LineagePath


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, check=True, text=True, capture_output=True
    ).stdout.strip()


def _repo_with_rename(tmp_path: Path) -> Path:
    repo = tmp_path / "warehouse"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "config", "user.name", "Cutset Test")
    _git(repo, "config", "user.email", "cutset@example.invalid")
    schema = repo / "customers.yml"
    schema.write_text("models:\n  - name: customers\n    columns:\n      - name: email\n")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "base")
    schema.write_text(
        "models:\n  - name: customers\n    columns:\n      - name: email_address\n"
    )
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "head")
    return repo


class _CapturedGateway:
    def collect_evidence(self, change, max_hops=3):
        source = AssetRef("urn:li:dataset:customers", "dataset", "customers")
        model = AssetRef("urn:li:mlModel:churn", "mlModel", "churn")
        return ImpactEvidence(
            source=source,
            lineage_paths=(LineagePath(source, model, change.old_name),),
            complete=True,
            change=change,
            schema_fields=("email",),
        )


class _FailingWriteGateway(_CapturedGateway):
    def write_back(self, report, tag_name="cutset-at-risk"):
        raise DataHubWriteBackError("write failed")


class _IncompleteGateway(_CapturedGateway):
    write_attempted = False

    def collect_evidence(self, change, max_hops=3):
        evidence = super().collect_evidence(change, max_hops)
        return ImpactEvidence(
            source=evidence.source,
            lineage_paths=evidence.lineage_paths,
            complete=False,
            change=change,
            schema_fields=evidence.schema_fields,
        )

    def write_back(self, report, tag_name="cutset-at-risk"):
        self.write_attempted = True


def test_cli_uses_real_git_and_writes_reports(tmp_path: Path, monkeypatch) -> None:
    repo = _repo_with_rename(tmp_path)
    output = tmp_path / "reports"
    monkeypatch.setattr(
        "cutset.cli.DataHubGateway.from_env", lambda: _CapturedGateway()
    )

    result = CliRunner().invoke(
        app,
        [
            "review",
            "--repo",
            str(repo),
            "--base",
            "HEAD~1",
            "--head",
            "HEAD",
            "--repository-id",
            "owner/repo",
            "--output",
            str(output),
        ],
    )

    assert result.exit_code == 4
    assert (output / "impact-report.json").exists()
    assert "ml_assets_affected" in (output / "impact-report.md").read_text()


def test_cli_preserves_reports_when_write_back_fails(tmp_path: Path, monkeypatch) -> None:
    repo = _repo_with_rename(tmp_path)
    output = tmp_path / "reports"
    monkeypatch.setattr(
        "cutset.cli.DataHubGateway.from_env", lambda: _FailingWriteGateway()
    )

    result = CliRunner().invoke(
        app,
        [
            "review",
            "--repo",
            str(repo),
            "--base",
            "HEAD~1",
            "--head",
            "HEAD",
            "--output",
            str(output),
            "--write-back",
        ],
    )

    assert result.exit_code == 6
    assert (output / "impact-report.json").exists()


def test_cli_never_writes_back_incomplete_evidence(tmp_path: Path, monkeypatch) -> None:
    repo = _repo_with_rename(tmp_path)
    gateway = _IncompleteGateway()
    monkeypatch.setattr("cutset.cli.DataHubGateway.from_env", lambda: gateway)

    result = CliRunner().invoke(
        app,
        [
            "review",
            "--repo",
            str(repo),
            "--base",
            "HEAD~1",
            "--head",
            "HEAD",
            "--output",
            str(tmp_path / "reports"),
            "--write-back",
        ],
    )

    assert result.exit_code == 3
    assert gateway.write_attempted is False
