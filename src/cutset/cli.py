from pathlib import Path

import typer

from cutset.application import AnalysisRequest, analyze
from cutset.change_detection import UnsupportedChangeError
from cutset.datahub_gateway import (
    DataHubContextError,
    DataHubGateway,
    DataHubWriteBackError,
)
from cutset.git_adapter import GitContextError
from cutset.reporting import render_markdown, write_reports


app = typer.Typer(no_args_is_help=True, help="Coordinate governed data changes with DataHub evidence.")


@app.callback()
def main() -> None:
    """Run the preserved ChangeMarshal impact-analysis fallback."""


@app.command()
def review(
    repo: Path = typer.Option(Path("."), exists=True, file_okay=False),
    base: str = typer.Option(..., help="Base Git revision."),
    head: str = typer.Option(..., help="Head Git revision."),
    repository_id: str = typer.Option("local/repository", help="Stable owner/repo ID."),
    output: Path = typer.Option(Path("changemarshal-output"), help="Report directory."),
    write_back: bool = typer.Option(False, help="Persist the report and risk tag in DataHub."),
    tag_name: str = typer.Option("changemarshal-at-risk", help="Existing DataHub risk tag name."),
) -> None:
    """Review one dbt column rename against live DataHub context."""
    try:
        gateway = DataHubGateway.from_env()
        report = analyze(
            AnalysisRequest(
                repo=repo.resolve(),
                base=base,
                head=head,
                repository_id=repository_id,
            ),
            gateway,
        )
    except (UnsupportedChangeError, GitContextError) as error:
        typer.echo(f"ChangeMarshal input error: {error}", err=True)
        raise typer.Exit(2) from error
    except DataHubContextError as error:
        typer.echo(f"ChangeMarshal context error: {error}", err=True)
        raise typer.Exit(3) from error

    write_reports(report, output)
    typer.echo(render_markdown(report))
    if not report.evidence.complete:
        raise typer.Exit(3)
    if report.remediation is not None and not report.remediation.validation.valid:
        raise typer.Exit(5)
    if write_back:
        try:
            gateway.write_back(report, tag_name=tag_name)
        except DataHubWriteBackError as error:
            typer.echo(f"ChangeMarshal write-back error: {error}", err=True)
            raise typer.Exit(6) from error
    if report.decision.blocks_merge:
        raise typer.Exit(4)


if __name__ == "__main__":
    app()
