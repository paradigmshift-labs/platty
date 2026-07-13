# Revised Retrieval Profile

Use this profile to evaluate the current production `platty-mcp-retrieval`
policy.

## Route Shape

```text
project_list / project_get
-> context_status
-> project_overview_get
-> glossary_list for inventory/comparison/ambiguity when required
-> glossary_translate for raw terms and candidates
-> epic_list
-> epic_get for plausible candidate epics before discarding them
-> document_list by branch:
   documentType=br for policy/rule/eligibility
   documentType=data_dictionary for entity, table, field, or data-shape questions
   documentType=design for product flow, capability, journey, admin workflow,
   data flow, integration, architecture, or implementation-facing questions
   documentType=ucl for capability, journey, screen, or user action questions
-> document_get / document_item_list
-> document_item_get for exact business evidence
-> document_resolve to follow explicit document/item links
-> rank linked api_spec/screen_spec/event_spec/schedule_spec candidates
-> spec_search/spec_list only when explicit links are absent, incomplete, stale,
   too broad, or the exact spec id is unknown
-> spec_get
-> spec_resolve
-> graph_trace / code_search when source-near impact or location is needed
-> workspace_repo_list / readonly_workspace_shell for bounded exact source reads
   when exposed and required
```

## Stop Depth

Pure overview questions may stop at overview, epic, and SSOT depth if the answer
does not claim exact API, screen, event, schedule, state transition,
operational-data metric, or source behavior.

If the answer would claim implementation behavior, response shape, writes,
emits, permissions, absence, or exact source behavior, continue to specs and
bounded source reads where available.

## Data Boundary

For conversion, funnel, or bottleneck questions:

- If a data MCP is exposed, read its guide and use read-only queries with
  sample/cohort limits.
- If no data MCP is exposed, answer only from SSOT/spec-derived funnel steps,
  instrumentation points, and hypotheses. Do not claim observed drops or causes.
