# MCP Evidence Gates

Use these gates before making factual claims from Platty MCP retrieval.

| Evidence | What it can prove | What it cannot prove |
| --- | --- | --- |
| Vocabulary normalization | Query expansion, aliases, candidate concepts | Business facts or implementation behavior |
| Project overview | Product-area orientation | Exact policy, response shape, code behavior, or complete scope |
| Epic map | Candidate scope and available document/spec surfaces | Final behavior or proof that adjacent candidates are absent |
| Search hit | Candidate discovery | A fact by itself |
| BR/DD/DESIGN/UCL item | Semantic routing and documented intent | Source-confirmed enforcement or implementation |
| Directional document-to-Spec resolution | Connected Specs and source-near anchors | Behavior without exact reads |
| Source-near spec | API/screen/event/schedule behavior close to source | Source truth when spec is thin, stale, or contradicted |
| Graph trace | Confirmed static edges for the chosen anchor/options | Exhaustive impact, especially when omitted/candidate edges exist |
| `code_search` | Candidate files, symbols, routes, or source locations | Exact implementation behavior without bounded source reads |
| Bounded `readonly_workspace_shell` source read | Exact source evidence within the shown line range | Behavior outside the displayed scope |

## Claim Gates

- Concept explanation: vocabulary and project/epic context may be enough when no
  implementation claim is made.
- Broad domain, comparison, inventory, or impact answer: complete the
  full-cycle map first; project overview, README-like artifact text, glossary,
  catalog rows, and search hits are only orientation.
- Business policy: read business-rule item; read connected spec/source before
  claiming enforcement.
- Data field meaning: read data-dictionary item; read connected spec/source
  before claiming exact usage.
- API response shape: read exact API spec; use source-level evidence if the spec
  does not fully establish the response.
- Permission, DB write, event emit, external call, negative source evidence:
  requires source-level evidence when the MCP server exposes it.
- Code behavior, scroll/timer accumulation, lifecycle handling, guard logic, or
  exact implementation claims: use `code_search` for candidate locations, then
  read the relevant bounded source with MCP `readonly_workspace_shell` before
  claiming the behavior.
- Broad inventory or impact: build the target map first; one hit is not enough.

## Negative Claim Gate

A search miss is not absence evidence. Do not claim that a concept, campaign
type, permission, API, field, screen, or impact does not exist from empty
`document_search`, `spec_search`, `code_search`, or glossary output alone.

Negative claims require one of:

- a complete relevant map for the branch plus exact item/spec reads showing the
  absence;
- source-level confirmation when the claim is about implementation, calls,
  writes, emits, permissions, response fields, or code location;
- a clearly stated boundary such as "not confirmed in the surfaces read" rather
  than "does not exist".

## Capability Gap Language

When a required MCP surface is missing, say:

```text
I can answer from the configured MCP evidence up to <surface>. I cannot confirm
<claim type> because <missing tool or tier> is not exposed by this MCP server.
```

Do not say:

```text
I will check the local SOT folder.
I will verify outside configured MCP tools.
There is no impact.
```
