---
name: platty-design-rapid-prototype
description: Use when the user explicitly requests a Platty Design Rapid Prototype from current PRD and User Stories.
---

# Platty Design Rapid Prototype

Use this skill only when the user explicitly requests a Rapid Prototype or asks
to build/revise the exploratory HTML prototype. This is a disposable review
artifact, not Feature Design approval and not a Figma handoff.

## Required inputs

`platty-mcp` is a required prerequisite for product evidence retrieval. If the
plugin or MCP client is missing or unconfigured, stop before creating HTML and
report that setup gap. For Codex, recover with `codex plugin add platty-mcp@platty --json`;
then use `platty-mcp:platty-mcp-client-setup` to configure
and verify the endpoint.

1. Load the Platty MCP context through `platty-mcp:using-platty-mcp` before
   reading product evidence.
2. Resolve the current project identity and retrieve the current PRD and User
   Stories. Do not infer missing or conflicting product scope; stop and report
   the evidence gap.
3. Design System resolution must resolve the registered repository with the companion setup contract. If
   it is absent or unavailable, use a neutral low-fidelity fallback and record
   that limitation in the handoff; never invent brand values from memory.
4. Inventory every in-scope actor, page/screen, state, route, and review-relevant
   interaction before writing HTML. The IA is page/screen destinations only:
   control-level actions belong in the screen function specification, not as IA
   nodes.

## Build and verify

Create a standalone `index.html` and `prototype_handoff.json` under:

```text
<SPEC>/.feature-prototypes/<prototype-id>/
```

The HTML must use native controls, visible number badges, adjacent matching
function-spec rows, page-only solid IA, responsive supported viewports, and one
persistent review memo per page. Make primary actions and decision-relevant
states reachable with example data, including validation and recovery. Run
`scripts/prototype-audit.mjs <absolute-index.html>`, then perform Behavioral
Acceptance in a real browser against every covered source scenario and modeled
control. Verify visible state transitions, navigation results, exported content,
memo isolation across navigation and reload, and every supported viewport. Record
expected and actual results plus evidence in the handoff, then run
`scripts/prototype-handoff-audit.mjs <absolute-index.html> <absolute-handoff.json>`.
Do not deliver until both audits pass. Record provenance, source revisions,
assumptions, decisions, open questions, Design System resolution, coverage,
unexplored IDs, audit summaries, Behavioral Acceptance evidence, and delivery
status in the `platty-design-prototype-handoff.v1` handoff.

Follow [the contract](references/rapid-prototype-contract.md) for the exact
HTML markers, review chrome, audit error codes, delivery boundary, and recovery
rules. Figma continuation, approval-ready claims, and Feature Design feedback
remain outside this skill.
