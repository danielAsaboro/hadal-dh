# Cutset

> Know what breaks before you merge.

Cutset is being built from the official DataHub Agent Starter for the Build with DataHub Agent Hackathon. The first vertical slice is specified in [`docs/superpowers/specs/2026-08-04-cutset-design.md`](docs/superpowers/specs/2026-08-04-cutset-design.md).

A minimal, forkable AI agent that **reads [DataHub](https://datahub.com) for context, takes an action, and writes the result back**.

It's a **learning starter, not production code** — one skeleton file + one goal file you can read in a few minutes, understand, and build your own agent on top of.

> **The loop:** read context → decide → act → write back.
> An LLM is capable but blind to your data stack. DataHub holds the context — schemas, lineage, ownership, glossary, quality. This wires the two together.

## Stack

- **[LangGraph](https://github.com/langchain-ai/langgraph)** — the agent loop
- **[DataHub Agent Context Kit](https://docs.datahub.com/docs/dev-guides/agent-context/agent-context)** — DataHub's read + write tools, directly in Python (no MCP server to run)
- **Your own LLM** — Claude, Gemini, OpenAI, or a local model (swappable via `AGENT_MODEL`)

## Requirements

- **Docker Desktop** — to run DataHub locally (8 GB+ RAM recommended)
- **Python 3.11** recommended (works on 3.9+)
- A running **DataHub instance** — [Quickstart](https://docs.datahub.com/docs/quickstart): `pip install acryl-datahub` → `datahub docker quickstart`
- A DataHub **personal access token** — UI → Settings → Access Tokens ([enable token auth first](https://docs.datahub.com/docs/authentication/personal-access-tokens) if the button is greyed out)
- An **LLM API key** for your provider

## Quickstart

```bash
cd datahub-agent-starter

python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env      # set DATAHUB_GMS_URL (http://localhost:8080), DATAHUB_GMS_TOKEN, and your LLM key

python agent.py
```

The agent reads DataHub, takes one action, writes the result back, and prints a plain-English report. Refresh the DataHub UI to see the change.

> ⚠️ **Notes**
> - This agent has **write access** to your catalog (`include_mutations=True`) — point it at a local/test instance first.
> - DataHub won't apply a **tag / term / owner that doesn't exist yet** — create it once (e.g. add the `needs-review` tag to any dataset in the UI) before the agent applies it.

## How it works

Two files, deliberately separated:

- **`agent.py`** — the skeleton, the same for any task: connect (`DataHubClient.from_env()`) → get tools (`build_langchain_tools(client, include_mutations=True)`) → pick an LLM (`init_chat_model`) → wire the agent (`create_react_agent`) and run the goal.
- **`goal.py`** — the one thing you change: a `SYSTEM_PROMPT` (how it behaves) and a `GOAL` (what to do).

**The skeleton stays the same; you swap the goal.**

## Make it your own

Open `goal.py` and rewrite `GOAL` — the tools and loop don't change, only your intent does:

- **Do real work** — find a dataset with a problem, fix it, write it back (the default here)
- **Generate code** — read real schemas + lineage, then generate a dbt model / SQL / DAG with real column names
- **Protect ML models** — trace lineage from training data to deployed models, flag what's at risk
- **Your idea** — anything that benefits from grounded catalog context

`goal.py` has commented example goals for each. See `prompts/` for AI-coding-assistant prompts to build or extend the agent.

## Resources

- [DataHub](https://datahub.com) · [Quickstart](https://docs.datahub.com/docs/quickstart) · [MCP Server](https://docs.datahub.com/docs/features/feature-guides/mcp) · [Agent Context Kit](https://docs.datahub.com/docs/dev-guides/agent-context/agent-context) · [DataHub Skills](https://github.com/datahub-project/datahub-skills)
- [Analytics Agent](https://github.com/datahub-project/analytics-agent) — a production-grade, open-source DataHub agent worth studying

## License

Apache License 2.0 — see [`LICENSE`](LICENSE). The incorporated DataHub Agent Starter attribution is preserved in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
