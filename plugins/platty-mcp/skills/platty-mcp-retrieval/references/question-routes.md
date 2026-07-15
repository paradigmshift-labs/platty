# MCP Question Routes

Use this reference after `platty-mcp-retrieval` chooses a branch. It adds
branch-specific document families, requirements, and completion checks to the
canonical ladder in `full-cycle-retrieval.md`. Do not duplicate or replace that
ladder here.

Tool names refer to intents in `../../using-platty-mcp/references/tool-mapping.md`.

## Contents

- Routing Precedence
- Concept Or Domain Term
- Policy, Rule, Permission, Eligibility
- Data Entity Or Field
- System Design Or Integration
- Capability, Journey, User Action
- Exact API, Screen, Event, Schedule
- Impact Or Blast Radius
- Code Location Or Source Absence
- Mixed Questions

When the Search Clarification Gate fires, carry the Search Brief into the
chosen branch. The branch route may refine `Question branch`, `Candidate MCP
route`, and `User decision needed`, but it must preserve the raw question and
the ambiguity trigger that caused the gate to fire.

Read attached memory summary cards on every selected
`project_overview_get.overview.memories`, `epic_get.memories`,
`document_get.memories`, document item, and spec result before discarding
candidates or finalizing semantic answers. If a memory title/contentPreview,
kind, level, trust, or alias relates to the user question, ambiguity,
correction, constraint, why, naming, deprecated behavior, or operational caveat,
call `memory_get` before the final answer. Keep memory separate from SOT/spec/
source proof, but treat unread relevant memory as an incomplete route.

Document family names such as BR, DD, DESIGN, and UCL are semantic labels in
this guide. When passing them to `document_list.documentType`, use the MCP
filter values (`br`, `data_dictionary`, `design`, `ucl`) unless the live tool
schema says otherwise. DD maps to `data_dictionary`, not `dd`.

## Routing Precedence

SDD file authoring intent routes request/story creation to
`platty-mcp-sdd-spec` and design/task creation to `platty-mcp-sdd-design`; it
takes precedence over generic impact or design-change wording. The owning SDD
skill may invoke impact as a sub-route, but retrieval must not bypass the
file-authoring owner.

Ordinary exact API, screen, event, schedule, and source-near questions remain
retrieval-only. Do not invoke impact analysis unless the question asks what
changes, what breaks, an affected surface, blast radius, cross-EPIC effect, or
design-change impact.

## Concept Or Domain Term

Use the Full-Cycle Retrieval Ladder. Include BR/DD/DESIGN/UCL only as the
concept requires, then descend to connected specs only when asserting
source-near behavior.

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

Use the Full-Cycle Retrieval Ladder. Required document families: BR for the
policy/rule/eligibility map; include DESIGN/DD/UCL when the rule depends on
system flow, data shape, or user journey. Enforcement claims require connected
spec evidence, and exact permission, validation, writes, emits, or absence
claims require source-level confirmation when exposed.

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

Use the Full-Cycle Retrieval Ladder. Required document family:
`data_dictionary` for entity/table/field meaning. Include connected specs only
when claiming API/screen/source-near usage.

Completion:

- read the selected parent `data_dictionary` document and inspect its attached
  memory cards before item-level conclusions; if cards are unavailable, call
  `memory_list(documentId)`, then `memory_get` for every relevant card;
- apply relevant parent-document memory even when one exact `dd_field` item is
  later resolved; keep it labeled as a memory overlay rather than SOT proof;
- name the entity or field item read;
- state whether usage is documented, source-near, or source-confirmed;
- do not treat whole-document search hits as field-level proof.
- for exact API or screen usage, rank connected `api_spec` and `screen_spec`
  candidates before opening details; direct document/spec links, same entity,
  same field, same route/screen/API target, and same branch intent rank first.

## System Design Or Integration

Use the Full-Cycle Retrieval Ladder. Required document family: DESIGN. For
selected design items, use `document_resolve(itemId)` before search and rank
linked API/screen/event/schedule candidates before exact spec reads.

Completion:

- state the design item or connection read;
- prefer item-level `document_resolve` before `document_resolve(documentId)` or
  search when a design item has been selected;
- resolve connected source-near evidence before asserting exact implementation.

## Capability, Journey, User Action

Use the Full-Cycle Retrieval Ladder. Required document families: UCL for user
action/journey; DESIGN is required when the question asks about product flow,
screen behavior, admin workflow, data flow, integration, architecture, or
implementation-facing behavior. For selected DESIGN/UCL items, use
`document_resolve(itemId)` before source-near search.

Completion:

- include DESIGN as the product/system map before UCL when the question asks
  about product flow, capability, journey, screen, admin workflow, or
  implementation-facing behavior;
- use `document_resolve(itemId)` as the first bridge from selected design/UCL
  items to screen/API specs; use `spec_search` only when linked context is
  absent, incomplete, stale, too broad, or leaves the exact spec id unknown;
- identify the user action or capability item;
- separate journey evidence from implementation evidence.
- for exact API or screen behavior, rank connected `api_spec` and `screen_spec`
  candidates before opening details, then read exact specs before source-near
  claims.
- for "difference between A/B/C" questions, treat this as an inventory until the
  relevant EPIC/document map is established;
- do not answer from the first matching UCL item if adjacent candidate EPICs
  remain unresolved.

## Exact API, Screen, Event, Schedule

Use the exact source-near branch of the Full-Cycle Retrieval Ladder. Start from
`spec_get` when the exact spec id is known; use `spec_list/spec_search` only
when the exact spec id is unknown. Follow selected specs with `spec_resolve`.

Completion:

- read the exact spec;
- cite unsupported fields as not confirmed;
- use source-level evidence if the spec is thin or contradicted.

## Impact Or Blast Radius

Use the Full-Cycle Retrieval Ladder to map the semantic target first. Then
resolve connected specs, read selected source-near specs, run `spec_resolve`,
and produce an Impact Seed Packet for `platty-mcp-impact-analysis`.

Completion:

- build the target map before answering broad inventory questions;
- for broad impact, record `Question branch: impact/blast radius` and the
  expected map source in the Search Brief before reading graph/source evidence;
- hand the packet to `platty-mcp-impact-analysis`, which owns graph, cross-EPIC,
  repository, and source convergence;
- reuse an existing packet rather than returning to semantic discovery;
- never convert empty graph evidence into "no impact".

## Code Location Or Source Absence

Use the source-near branch of the Full-Cycle Retrieval Ladder. Prefer a known
spec id when available; otherwise use code search only after the semantic route
has fixed the target scope.

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

Use the Full-Cycle Retrieval Ladder twice as needed: semantic branch first for
vocabulary, EPIC, and document scope; source-near branch second for exact spec,
graph, code, or snippet confirmation.

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
