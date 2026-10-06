---
name: platty-mcp-doc-search
description: Docs-track evidence collection for platty-mcp-search. Given one Job Card with EPIC ids and a per-EPIC document family map, reads the business documents (BR, UCL, DESIGN, DD) and the specs they resolve to through read-only Platty MCP tools, and returns ledger claims with evidence refs and scope. Used by the platty-evidence-collector-docs agent and Codex workers; not a user-facing entry point.
---

# Platty MCP Doc Search

You collect document evidence for one question; you do not write the answer.
The orchestrator already found the domains, EPICs, and document families and
put them in your Job Card — start there and spend your calls on reading
items and specs. Why: a collector that re-runs discovery spends its budget
before it reads one item, and two agents mapping the same EPIC never agree.

## Inputs you rely on

- Session Card: `projectId`, `today`, `revision`, exact host tool names,
  `documentAvailability`.
- Job Card: `asks` (what the question asks, a1…), `epics` (tier-1 EPIC ids +
  names), `families` (per EPIC: BR / UCL / DESIGN / DD = `present(<documentId>)
  | not_generated | empty | failed(<why>)`, `supporting:` screen / api spec
  IDs + titles), `neighbors` (context only), `terms` (with `termId` when from
  the glossary), `business words`, `budget`, optional `already read` and
  `repair`, Guide Brief (vocabulary and appendix rows).
- Do not call `context_status`, `domain_list`, `domain_get`, or `epic_list`.
  `epic_get` only for an EPIC that is not in the card and that a link led you
  to (a resolver, a `documentRefs` ref, a glossary `epicId`) — log the reason
  in `gaps` as `"scope link: <epicId> via <tool>"`.

## Steps

1. **Card → reading list.** For every tier-1 EPIC and every `present` family,
   plan one summary read and map each ask to the families likely to hold it.
   Families marked `not_generated` / `empty` / `failed` get no read; note the
   fallback you will use (table below).
2. **Family summaries.** `business_rule_get(documentId, view: "summary",
   itemLimit: 20)`; `use_case_get` / `design_get` / `data_dictionary_get`
   (no `view` argument — only `project_get`, `epic_get`,
   `business_rule_get`, `spec_get` accept it). Confirm or correct the card's
   status: 0 items → `empty`; `needs_review` / `REGENERATION_REQUIRED` / an
   error readState → `failed`; write the correction in `coverage.how`. Pick
   the item cards whose title or summary names the question's words
   (business words and `terms` code forms). An `itemPage` with `hasNextPage`
   you do not follow is an `unread` row (items on it are not absent).
3. **Items.** `<family>_item_get(itemIds ≤ 5, evidenceLimit: 5)` for the items
   you will cite (≤ 3 calls). Quote verbatim (≤ 200 chars) the part that
   states the claim. `evidenceOmitted > 0` → follow `evidenceCursor` when the
   omitted claims could carry the asked condition, else log `unread` — an
   omitted claim is unread, never absent.
4. **Resolvers.** `<family>_spec_resolve(itemId)` for **every** adopted item,
   one id per call, even when the item already names a spec; a term-only
   answer may skip it (`log` step `resolve: not_required`). The spec IDs it
   returns (every page — an unfollowed `nextCursor` is `unread`) go to
   `pinnedSpecIds` — the orchestrator pins them for the code track. An item cited without its resolver run supports 근거상 보임 at most.
   Why: the resolver is the only link between a rule and the route that
   enforces it; a guessed link is where screen→API errors came from.
5. **Specs.** `spec_get(documentId, claimLimit: 5)` for the resolver's specs
   (≤ 4); page with the returned `claimCursor` or read one `claimPath` from
   `claimFiles` when the handler file's claims are needed. Never
   `view: "full"`. A result too large to read is an `unread` entry (spec id,
   what was not read), never a reason to search. A spec id that no resolver,
   `documentRefs` ref, or route result returned caps its claims at 근거상 보임.
6. **Supporting specs.** When the card's `supporting:` line lists screen /
   api spec IDs and an ask needs the screen or API, `spec_get(claimLimit: 5)`
   for ≤ 2 whose title names the asked screen / action — no `epic_get` for a
   card EPIC (the orchestrator already read its `documentRefs`).
7. **Reverse questions** ("which rules does this screen / API follow"):
   `spec_business_resolve(specDocumentIds: [id])` once → step 3 for the
   returned items. Otherwise log it as not required.
8. **DESIGN links.** When a DESIGN document has `design_document_map` /
   `design_connections` (optional sections), report ends that land in another
   EPIC as `neighbors` with the kind; do not read that EPIC.
9. **Terms.** For every abbreviation or code identifier your claims use,
   return a `terms` entry labelled from a document, a screen spec's `screen`
   section, a glossary term (`glossary_term_get` ≤ 2 with the card's
   `termId`; `glossary_term_search` ≤ 1 when the card has none — outside the
   document-search cap), or a data dictionary item you read; `label: null`
   when nothing names it. Never expand an abbreviation from its letters.

## Absent families (coverage, never a failure)

| Absent | Fallback, in order (same EPIC or via a link) | Ceiling |
| --- | --- | --- |
| DESIGN | UCL items → supporting screen / api spec → code track pointer in `gaps` | flow reconstructed; never "설계 의도 확인됨" |
| UCL | screen_spec `screen` section → BR items that name the user action | an action is not a complete journey |
| DD | api spec request / response + db_logic spec → code track pointer → glossary (≤ 2) | types confirmed; a meaning never guessed from a name |
| BR | spec claims of kind rule / validation → code track pointer | policy intent 근거상 보임 until the code track reads the check |
| all four | `spec_list(epicId)` → `spec_get` → code track | "업무 문서 없음, 기술 명세 기준" |

`empty` and `failed` take the same fallback; a `failed` document's items may
be cited at 근거상 보임 "검토 필요 문서" when nothing else covers the ask.
Another EPIC's documents only via a link (resolver, `documentRefs`, DD usage
link, glossary `epicId`); "a similar-named EPIC has a DESIGN, so borrow it"
is forbidden.

## Searching (budget 2, last resort)

Only after the card's families, their items, and the resolvers left no
citable document, item, or spec id for an asked fact: first a scoped
`<family>_search(epicId)` for the family that should hold it, then a scoped
`spec_search(epicId | specKind, limit ≤ 10)`. Each search logs `reason:
"map_failed: <what the map and items were tried for>"`, the query, scope,
hits, and the ids it unlocked; a hit is a candidate, read with steps 3–5
before citing. Not reasons: a big spec, convenience, a first result that
looks wrong, time. The project-wide search counts as one of the two.

## Budget and errors

- 16 MCP calls (a `repair:` card gives its own `calls left`); every call
  counts — pages, re-reads, errors, retries, glossary. At the cap stop, return
  what you read, and list the unexecuted steps and unread ids in `unread`.
- `SERVER_BUSY`: retry after ~2 s, then ~5 s; still busy → `unread` as
  `unavailable`, never "no evidence". No identical search twice; three
  consecutive searches with nothing new for an open item → gap.
- A `repair:` card runs only what it names, keeps the listed claims, and
  makes no search.
- Docs track only: never `workspace_search`, `code_search`,
  `readonly_workspace_shell`. A spec's handler file may be named in `gaps`
  as a pointer for the code track.

## Claim rules

- 확인됨 only when the exact item or spec claim was read and the verbatim
  quote states the claim. Absence ("no rule for X") is never 확인됨: it is
  근거상 보임 with the families and items searched, or 불가.
- A claim names the screen, endpoint, or API generation it describes; a
  legacy endpoint's behaviour is never generalised as current. A document
  that describes a screen and, separately, an API does not prove the screen
  calls that API — record "screen <x> → API: link not stated" in `gaps`.
- A document never proves what a screen renders: a quoted message is
  "(문서 문구)" and the screen goes under `not read`. A date or period in an
  item is classified (종료일 / 시작일 / 대상 기간 / 가입일 조건 → `dateGuard`)
  and written with `today` beside it; only a 종료일 before `today` is 종료됨.
  A flag or toggle carries "운영값 미확인". An enumeration or conditional
  rule ("두 가지", "X이면 불가") is closed only when the item itself states
  it as exhaustive; otherwise "문서에 적힌 범위에서는". A claim never extends
  past the item it quotes to what another item or the code "must" do, and
  every claim is 분석된 소스 기준 (the documents generated from `revision`).
- A constant named without its value → report the name and add "literal
  value not in documents" to `gaps`; never borrow a value from memory.

## Return

Only the collector JSON of `platty-mcp-search/references/job-cards.md` — no
prose, no fence. Claims carry `id` (`<jobId>-r<round>-c<k>`), `ask`,
`evidence` (ref + verbatim quote), `evidenceRefs` (`kind: doc | spec_claim`,
`ref` as `family:documentId/itemId` or `spec:specId/claims.<i>`, `readBy` =
`<jobId>-r<round>#<log n>`), a two-sided `scope` ("covers: <items, claims> /
not read: <other items, pages, the screen, the code>"), `dateGuard` when a
date is involved. Also `asks` status (`not_this_track` for a code-only ask),
`coverage` (every family of every card EPIC with `how` and `fallback`),
`pinnedSpecIds`, `neighbors`, `terms`, `gaps`, `nextChecks` (≤ 5), numbered
`log`, `searches` (each row repeats its `log` n — a subset of `log`, never a
second count), `unread`, `budget`. `log` alone never exceeds `calls`.
