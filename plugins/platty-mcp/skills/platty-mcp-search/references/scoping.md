# Scoping: domains → EPIC tiers → neighbours → route candidates

Run by the main session only, once per question, before any collector. It
reads the map — names, summaries, counts, list rows, spec headers — and never
a rule item, a spec claim, or source for evidence: the map decides *where* to
read, the collectors decide *what is true*. Typical cost 20–35 light calls per
question (SKILL.md's per-question budget caps the total; cut §5 first).
Collectors never repeat any of it (no `domain_list`, `domain_get`,
`epic_list`; `route_resolve` only for a wrong candidate).

## 1. Words and readings

- The `asks` (each distinct thing the question asks), the core noun(s) and
  screen words, plus their Term Map code forms (guide vocabulary;
  `glossary_term_search` / `glossary_translate` when listed and not reported
  unavailable — keep the `termId`). A glossary hit's `epicId` is a candidate EPIC.
- 1–3 interpretations: a screen / menu / program whose name literally matches
  the phrase ("<기능명> 화면") is the primary reading; a sub-step saved inside
  another feature's flow is a second reading. Never drop a reading silently.

## 2. Domains

- `domain_list(limit: 200)`. The default page is 50; `query` is a keyword
  filter on names, not semantic ("정산" finds "정산 및 세무", "돈 돌려받기"
  finds nothing). With `pageInfo.hasNextPage`, narrow with `query` for the
  core noun, then each synonym, then the screen word, and only then follow
  `nextCursor`. Never declare a domain absent from a truncated page.
- `domain_get` for up to 3 domains whose name or summary carries the core
  noun or screen word — one matched domain is not a fence.

## 3. EPIC candidates and tiers

- `epic_list(domainId, limit: 200)` per opened domain (follow `nextCursor`).
  Candidates = every EPIC whose name or summary contains the core noun or
  screen word; ≈10 is normal.
- Tier per candidate, recorded with its reason:
  - `strong` — the name contains the core noun or screen word; a glossary
    term carries its `epicId`; or its spec list has an owner spec whose
    title / path names the asked screen or action;
  - `medium` — summary match only, or a shared-spec / event-flow neighbour (§5);
  - `weak` — navigation-only neighbour, or a match on a generic word.
- Tier 1 = the 2–3 strongest (primary reading first); tier 2 = the remaining
  `strong` (listed first) then `medium`; tier 3 = `weak`. The cap limits what
  is read first, not what is listed: every unopened candidate is named in the
  answer as unread scope ("<EPIC>도 확인해 볼까요?"). A run that capped
  candidates at three missed the EPIC that held the feature, and a run that
  read ten EPICs' documents ran out of budget.

## 4. Family map (tier-1 EPICs)

- `epic_get(epicId, view: "summary")` → `documentAvailability` (br, ucl,
  design, data_dictionary counts) and `supportingDocumentAvailability`
  (screen / api specs owned elsewhere).
- For each family with count > 0: `<family>_list(epicId)` → document ID,
  `validity`, `documentStatus`. Classify `present(<documentId>)` |
  `not_generated` (count 0, no row, no supporting ref) | `empty` (a row but
  0 items — the collector confirms when it reads) | `failed(<why>)`
  (`needs_review`, `regeneration_required`, an error readState). Use the
  EPIC's own counts, never project totals. The map, plus the supporting spec
  IDs + titles that §5 step 1 read from `documentRefs`, goes into the docs
  Job Card (the collector never calls `epic_get` for a card EPIC); the docs
  collector corrects the map from what it reads (`coverage.how`).

## 5. Cross-EPIC neighbours (≤ 3–5 per tier-1 EPIC, ≤ 6 calls)

3 of 7 past misses sat one hop from the first candidates; neighbours per EPIC
run 3–16, so cap and rank. No tool returns an EPIC dependency list — derive
neighbours cheapest first:

1. shared spec — `epic_get(view: "full")` `documentRefs` minus the EPIC's own
   `spec_list` rows are specs owned elsewhere; for ≤ 3 whose title names a
   question word, `spec_get(documentId, claimLimit: 1)` and read only the
   header `epicId` / `epicName` → reason `shared-spec via documentRefs`;
2. `spec_business_resolve(specDocumentIds: [top owner spec])` once → items
   whose document belongs to another EPIC → `shared-spec via
   spec_business_resolve`;
3. `spec_impact_resolve(specDocumentIds: [that spec], direction: "both")`
   once → `nodes[].documentIds` → header `epicId` for ≤ 2 → reason
   `event_flow: <edge kind>` for `publishes_event | triggers | trigger_target
   | scheduled_action`, else `service-map: <edge kind>` (`calls_api`,
   `accesses_db`, `navigates`, `uses_external_service`, …); a `nextCursor`
   not followed is unread scope;
4. summary match in the opened domains (`summary-match: <word>`);
5. glossary hit whose `epicId` is outside tier 1 (`glossary: <term>`).

Rank shared-spec and event-flow first, then name / summary, then navigation.
A neighbour enters tier 2 or 3 with its reason; one already a candidate keeps
its tier. Header reads here are link evidence only — nothing from them enters
a claim. DESIGN document maps are read by the docs collector, which returns
cross-EPIC ends as `neighbors`; merge them before any expansion.

## 6. Route candidates (code Job Card)

- `spec_list(epicId, limit: 200)` per candidate EPIC in tier order (follow
  `nextCursor`), plus the supporting refs found in §5. Row: `{specId, type,
  title or path, epicId, tier, role: owner | supporting, entryPointId |
  null}`. `spec_list` rows carry no entryPointId — leave `null` unless a
  header or `route_resolve` already returned it; the code collector fills it
  from `spec_get`.
- Rank by the question's words, screen names, and Term Map code forms against
  title / path / summary: tier-1 owner → tier-1 supporting → tier 2. The top
  ~15 are priority rows (full); the rest go in as ID + title only.
- `route_resolve` during scoping only in code-only mode, when no spec title matches the asked screen /
  action, or — interface / file / batch words (SFTP, 수신, 연동, 배치, 인터페이스) — always as `kinds: ["job"]`
  over the whole project, even when a spec matches (SKILL step 2) (≤ 3 identifiers, `includeDeprecated:
  false` first). Its rows enter as `{entryPointId, kind, path, repoId, specDocumentIds}`;
  `specDocumentIds: []` makes an entry-point-only row (the code collector skips `spec_get` for it).
  Code-only mode scopes by screen / menu / program names through the Session Map and `route_resolve`
  instead of §2–§4.
- The list carries no handler, class, table, or method names and no document
  conclusion: it says where to start, never what to find. A collector handed
  a hypothesis builds a confident story around it.

## 7. Clarification gate

Ask once — `AskUserQuestion` (Claude Code), `request_user_input` (Codex), or a
plain question and stop — only when all hold: the run is interactive and a
single question; ≥ 2 readings remain whose answers would materially differ (a
different EPIC, screen, or flow, not wording); no map name settles it. Offer
2–4 options, each a map name (EPIC / screen / menu). Never ask about facts the
tools answer (which EPIC holds a screen, which API a button calls), never in
a question list or a `-p` / `exec` run (answer each reading with its own 결론 and
say which reading each block answers), never a second question on the same
question; no answer → every reading is answered.

## 8. Expansion after the tier-1 audit

Open tier 2 — family map, a docs job, and a code job with tier-2 candidates
(tier-1 `already read` carried) — only on a trigger: (a) an ask has no claim
and no 불가 on both tracks; (b) no tier-1 route or spec matched the asked
screen / action (`routeCandidates.consumed` empty for that ask, docs pinned
nothing); (c) the tracks conflict and neither read the deciding path. A
second trigger opens tier 3, the last round. Record `확장: tier 2 — trigger
a|b|c: …` or `확장: not needed` in the ledger `notes`. Unexpanded
candidates and neighbours go to 확인할 수 없는 부분 as "<EPIC 이름> — 이번에 열지
않음 (<reason>) — 그 EPIC 문서에서 확인" — never read "to be safe".

## Tool notes

- `view` is accepted only by `project_get`, `epic_get`, `business_rule_get`,
  and `spec_get`; elsewhere it returns `INVALID_INPUT`.
- `spec_impact_resolve` takes `specDocumentIds` (not `specIds`) and
  `direction: incoming | outgoing | both`.
- `spec_get` returns the summary with one page of claims by default:
  `claimLimit: 1` for a header, `claimLimit: 5` for reading; never
  `view: "full"`.
- `<family>_list` rows carry `validity` and `documentStatus`
  (`passed | needs_review`); `<family>_get` carries `items` / `readState`.
- `SERVER_BUSY` is a queue signal: retry after ~2 s and ~5 s; still busy →
  record it as unavailable, never as absence.
