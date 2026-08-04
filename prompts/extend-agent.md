# Prompt: Extend the agent (add one owner capability)

---

Extend the existing agent so that, after it tags a dataset `needs-review`, it **also
assigns an owner** to that same dataset. Keep the change minimal:

- Reuse the tools and agent already wired up — don't restructure the project. The
  `add_owners` tool is already available (mutations are enabled).
- Update `goal.py` so the `GOAL` also asks the agent to set an owner on the flagged
  dataset. Use a corpuser URN, e.g. `urn:li:corpuser:datahub`.
- Don't touch `agent.py` — only the goal changes.

Then show me the updated `goal.py` and how to re-run.

---
