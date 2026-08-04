"""
DataHub Agent Starter — a minimal agent that reads DataHub for context,
takes an action, and writes the result back.

This file is the SKELETON. It is the same for every hackathon challenge.
The only thing you change per challenge is the GOAL — see goal.py.
Fork it, change the goal, ship your submission.

Stack:
  - LangGraph        -> orchestration (the agent loop)
  - Agent Context Kit -> DataHub tools as LangChain tools (no MCP setup needed)
  - your own LLM      -> Claude / Gemini / OpenAI / local, swappable via AGENT_MODEL
"""

import os
import warnings

# Keep the console clean: hide third-party deprecation / experimental notices.
# These are informational only — delete this line if you want to see them.
warnings.filterwarnings("ignore")

from dotenv import load_dotenv
from datahub.sdk.main_client import DataHubClient
from datahub_agent_context.langchain_tools import build_langchain_tools
from langchain.chat_models import init_chat_model
from langgraph.prebuilt import create_react_agent

from goal import GOAL, SYSTEM_PROMPT

load_dotenv()

# Default model. Override with AGENT_MODEL, e.g.:
#   anthropic:claude-sonnet-5  |  openai:gpt-...  |  google_genai:gemini-...
DEFAULT_MODEL = "anthropic:claude-sonnet-5"


def build_agent():
    # 1. Connect to DataHub. Reads DATAHUB_GMS_URL + DATAHUB_GMS_TOKEN from the env.
    client = DataHubClient.from_env()

    # 2. Get DataHub's capabilities as LangChain tools.
    #    include_mutations=True turns on write-back (add_tags, add_owners,
    #    update_description, ...). This is the whole DataHub integration — no MCP
    #    server or client to run; the tools call DataHub directly.
    tools = build_langchain_tools(client, include_mutations=True)

    # 3. Your LLM — the reasoning engine. Swap the provider:model string freely.
    model = init_chat_model(os.environ.get("AGENT_MODEL", DEFAULT_MODEL))

    # 4. Wire the agent: model + DataHub tools + a system prompt describing how to behave.
    return create_react_agent(model, tools, prompt=SYSTEM_PROMPT)


def main():
    agent = build_agent()
    try:
        result = agent.invoke({"messages": [{"role": "user", "content": GOAL}]})
        # The agent's final message is its report of what it read, did, and wrote back.
        print(result["messages"][-1].content)
    except Exception as e:
        # Fail gracefully instead of dumping a stack trace on screen.
        print(f"\nThe agent stopped early: {e}\n")
        print(
            "Most likely cause: a tag, glossary term, or owner it tried to apply "
            "doesn't exist in DataHub yet — create it once, then re-run. "
            "(DataHub won't apply a label that hasn't been created.)"
        )


if __name__ == "__main__":
    main()
