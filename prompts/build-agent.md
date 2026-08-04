# Prompt: Build a DataHub Agent from scratch

Paste this into an AI coding assistant (Claude Code, Cursor, Codex, Gemini CLI, …).
It works best with the **DataHub Skills** installed, which give the assistant the
know-how to use DataHub correctly:

```bash
npx skills add datahub-project/datahub-skills
```

Edit the **Task** section for your own use case — everything else stays the same.

> **What this is:** a learning starter, not production code. The goal is a *working starting
> point* you understand and can build on. Review what the assistant writes before you trust it
> (that's the whole skill), and expect a small tweak or two — for example the model id for your
> LLM provider, or creating a tag / term / owner in DataHub first (DataHub won't apply a label
> that doesn't exist yet).

---

## Goal
Build a small, readable Python agent that connects to DataHub, reads context, takes
**one** concrete action, and writes the result back to the catalog. Keep it minimal —
a starting template, not a framework.

## Tech stack (what this starter uses)
- **LangGraph** for the agent loop — `langgraph.prebuilt.create_react_agent`
- **DataHub Agent Context Kit** for the tools — `build_langchain_tools(client, include_mutations=True)`
- **`init_chat_model`** so the LLM provider is swappable
- **python-dotenv** for config

## DataHub access
- Connect with `DataHubClient.from_env()` (reads `DATAHUB_GMS_URL` + `DATAHUB_GMS_TOKEN`).
- Get tools via `build_langchain_tools(client, include_mutations=True)`. This returns
  both read tools (`search`, `get_entities`, `get_lineage`, `list_schema_fields`) and
  write tools (`add_tags`, `add_owners`, `update_description`, …). No MCP server needed —
  the tools call DataHub directly.

## Behavior (system prompt)
The agent should: read context first, take ONE concrete action, write it back, and
report what it did in plain English. It must never act on an entity it hasn't inspected,
and must find URNs via search rather than guessing them.

## Task (change this for your use case)
Look at the healthcare datasets in DataHub. Find a dataset that has no owner assigned.
Investigate it (schema, lineage, ownership), then tag it `needs-review` and update its
description to note the missing owner and anything else you find. Report which dataset
you flagged and why.

## Files to produce
- `agent.py` — the skeleton: connect → build tools → init LLM → `create_react_agent` → run the goal → print the report
- `goal.py` — `SYSTEM_PROMPT` (the behavior above) + `GOAL` (the task above), kept separate so the goal is easy to swap
- `requirements.txt`, `.env.example`, `README.md`

## Constraints
- Python 3.9+, type hints, minimal dependencies.
- Never hardcode secrets — read everything from env / `.env`.
- Keep `agent.py` and `goal.py` separate: the skeleton is reusable, only the goal changes.

---

### How to adapt the Task per use case
- **Do real work:** the task above (find a problem → fix it → write back).
- **Generate code:** "Read the schema and lineage of `<table>`, then generate a dbt model / SQL that builds it using the real column names."
- **Protect ML models:** "Trace lineage from training data to deployed models; flag any model that's at risk from an upstream change."
- **Your idea:** anything that benefits from grounded catalog context. The stack and tools don't change — only the Task does.
