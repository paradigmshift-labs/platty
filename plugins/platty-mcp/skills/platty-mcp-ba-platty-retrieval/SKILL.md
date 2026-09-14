---
name: ba-retrieval
description: Retrieve bounded Heroines evidence from Platty for a BA stage without returning raw MCP output to the interview orchestrator. Use when a stage needs current service facts or source confirmation.
---

# BA Platty Retrieval

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Use `platty-mcp-retrieval` for every Platty evidence read. It owns MCP tool
selection, capability checks, project resolution, freshness checks, and the
map-first/direct-first retrieval route. Do not create a BA-specific subagent,
declare MCP tool names, or bind this workflow to an MCP server alias.
Do not probe candidate endpoints, inspect host-local files, or use a local CLI
fallback. If the capability gate is blocked, return its exact configuration gap
to the BA stage so it can leave the case waiting.

Pass the retrieval route a narrow brief: current `projectId` when selected,
BA stage, question, required evidence, and case path. The BA stage owns the
interview artifact and writes only the bounded Evidence Packet below after the
retrieval route returns. It must not ask the user, create decisions, or call
`session.py` while gathering an existing-service fact.

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

Do not include raw MCP payloads, search result dumps, or chain-of-thought in
the interview artifact. Limit excerpts to the facts needed by the requested
stage. The parent validates the packet, records tool receipts, and updates the
artifact.
