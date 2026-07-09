# MCP Question Routes

Use this reference after `platty-mcp-retrieval` chooses a branch. Tool names
refer to intents in `../../using-platty-mcp/references/tool-mapping.md`.

When the Search Clarification Gate fires, carry the Search Brief into the
chosen branch. The branch route may refine `Question branch`, `Candidate MCP
route`, and `User decision needed`, but it must preserve the raw question and
the ambiguity trigger that caused the gate to fire.

## Concept Or Domain Term

Route:

```text
project context
-> project overview
-> vocabulary normalization
-> epic_list
-> epic_get for each plausible concept epic
-> document_list for BR/DD/DESIGN/UCL candidates as the concept requires
-> document_item_list
-> document_item_get for exact concept evidence
-> document_resolve
-> spec_get when asserting source-near behavior
```

Completion:

- preserve the raw user phrase;
- state normalized terms when used;
- expose ambiguity when normalized candidates point to different concepts;
- when a term can mean a user-facing label, business concept, enum/model value,
  or implementation branch, name the split before answering and keep the
  selected interpretation in the Search Brief.
- run the Final Route Audit before saying a normalized concept is absent or not
  independent;
- when the raw term is Korean and the likely system term is English, keep both
  terms in the answer boundary.

## Policy, Rule, Permission, Eligibility

Route:

```text
project context
-> vocabulary normalization when needed
-> epic_list
-> epic_get for policy candidate epics
-> document_list(documentType=BR, epicId=<candidate>)
-> document_get/document_item_list for rule maps
-> document_item_get for exact business-rule items
-> document_resolve
-> spec_list/spec_resolve when connected specs must be mapped
-> spec_get before claiming enforcement
-> code_search then code_snippet when claiming exact permission, validation, writes, emits, or absence
```

Completion:

- identify the rule item;
- distinguish documented intent from confirmed enforcement;
- read connected spec or source-level evidence before claiming permission,
  validation, response shape, DB write, or event emit behavior.
- run the Final Route Audit before any enforcement, permission, eligibility, or
  negative claim;
- preserve raw terms, normalized terms, and the selected interpretation when
  vocabulary routing changed the branch;
- preserve discarded interpretations when dropping them changes the answer
  boundary;
- preserve unread-but-relevant policy, rule, spec, or source surfaces as
  coverage limits or next MCP reads;
- when the claim is "not allowed", "not eligible", "not enforced", or similar,
  confirm the negative boundary from exact item/spec/source evidence instead of
  a search miss.

## Data Entity Or Field

Route:

```text
project context
-> vocabulary normalization when needed
-> epic_list
-> epic_get for data candidate epics
-> document_list(documentType=DD, epicId=<candidate>, entityName=<entity when known>)
-> document_get/document_item_list for entity maps
-> document_item_get for exact entity or field evidence
-> document_resolve
-> spec_get for source-near usage
-> code_search then code_snippet when claiming exact source usage
```

Completion:

- name the entity or field item read;
- state whether usage is documented, source-near, or source-confirmed;
- do not treat whole-document search hits as field-level proof.

## System Design Or Integration

Route:

```text
project context
-> epic_list
-> epic_get for design candidate epics
-> document_list(documentType=DESIGN, epicId=<candidate>)
-> document_get/document_item_list for design maps
-> document_item_get for exact design items
-> document_resolve
-> spec_list/spec_resolve for connected API, DB, event, service, screen, or spec evidence
-> spec_get
-> code_search then code_snippet when asserting exact implementation behavior
```

Completion:

- state the design item or connection read;
- resolve connected source-near evidence before asserting exact implementation.

## Capability, Journey, User Action

Route:

```text
project context
-> vocabulary normalization when needed
-> epic_list
-> epic_get for capability candidate epics
-> document_list(documentType=UCL, epicId=<candidate>)
-> document_get/document_item_list for capability maps
-> document_item_get for exact UCL items
-> document_resolve
-> spec_get for source-near behavior claims
-> code_search then code_snippet when source-level confirmation is required
```

Completion:

- identify the user action or capability item;
- separate journey evidence from implementation evidence.
- for "difference between A/B/C" questions, treat this as an inventory until the
  relevant EPIC/document map is established;
- do not answer from the first matching UCL item if adjacent candidate EPICs
  remain unresolved.

## Exact API, Screen, Event, Schedule

Route:

```text
exact anchor
-> spec_list/spec_search only if the exact spec id is unknown
-> spec_get for exact source-near spec
-> code_search then code_snippet when response shape, permission, writes, emits, or absence matters
```

Completion:

- read the exact spec;
- cite unsupported fields as not confirmed;
- use source-level evidence if the spec is thin or contradicted.

## Impact Or Blast Radius

Route:

```text
Search Brief
-> semantic branch to map the policy/rule/data/design/capability target
-> document_resolve for connected specs
-> spec_list/spec_get for source-near target map
-> graph_trace/code_search only after the target map exists
-> code_snippet when source-level impact evidence is required
```

Completion:

- build the target map before answering broad inventory questions;
- for broad impact, record `Question branch: impact/blast radius` and the
  expected map source in the Search Brief before reading graph/source evidence;
- report graph/source omissions and missing capability tiers;
- never convert empty graph evidence into "no impact".

## Code Location Or Source Absence

Route:

```text
source-near spec or code term
-> spec_get when a source-near spec is known
-> code_search
-> code_snippet when configured
```

Completion:

- state repo, file, and line scope;
- state exact terms searched;
- run the Final Route Audit before any source absence or negative location
  claim;
- do not claim absence outside the searched scope;
- preserve searched scope, exact terms, selected interpretation, and discarded
  interpretation when a business term was translated into code terms;
- preserve unread-but-relevant MCP surfaces and missing MCP surfaces before
  turning a search miss into an absence boundary;
- require source-level confirmation when the answer claims exact code absence,
  lack of writes/emits/calls, or a permission/validation path is not present;
- if the question mixes a source-location request with a business term, keep
  both routes visible in the Search Brief: semantic route first, source-near
  confirmation second.

## Mixed Questions

Route:

```text
Search Brief
-> semantic branch for vocabulary, EPIC, and document scope
-> source-near branch for exact spec, graph, code, or snippet confirmation
```

Completion:

- split business meaning from implementation fact before answering;
- use MCP evidence to choose the branch order before asking the user;
- ask one clarifying question only when MCP evidence leaves tied
  interpretations and choosing one would hide the other;
- preserve raw terms, normalized terms, and unread-but-relevant surfaces across
  both branches;
- state the selected interpretation in the answer when it changes the route;
- state discarded interpretations when they would otherwise make the source or
  semantic branch look complete;
- run Final Route Audit after the semantic branch and before source-near claims;
- if the audit finds a missing semantic candidate, return to the map before
  reading more code/search hits.
