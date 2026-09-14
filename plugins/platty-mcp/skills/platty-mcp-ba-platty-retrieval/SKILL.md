---
name: ba-retrieval
description: Retrieve bounded Heroines evidence from Platty for a BA stage without returning raw MCP output to the interview orchestrator. Use when a stage needs current service facts or source confirmation.
---

# BA Platty Retrieval

Use a dedicated `platty-retriever` subagent for Platty MCP reads. The orchestrator starts it with `fork_turns: none` and supplies only the retrieval brief: project ID, current stage, question, required evidence, and case path.

The retriever may use configured read-only Platty tools. It must not ask the user, edit interview artifacts, create decisions, or call `session.py`.

## Evidence Packet

Return one bounded JSON packet:

```json
{
  "project_id": "...",
  "stage": "planning_context",
  "direct_facts": [{"text": "...", "source_id": "..."}],
  "sources": [{"reference": "...", "excerpt": "...", "revision": "..."}],
  "limits": ["..."],
  "next_action": "none | platty | ask_user"
}
```

Do not return raw MCP payloads, search result dumps, or chain-of-thought. Limit excerpts to the facts needed by the requested stage. The parent validates the packet, records tool receipts, and updates the artifact.
