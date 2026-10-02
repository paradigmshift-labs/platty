---
name: platty-mcp-hybrid-qa
description: Use when answering one or many non-developer business or operational questions (a single question, several questions, or a QA list) about a Platty project through Enterprise MCP tools, combining business documents and source code; splits each question into parallel docs and code evidence collectors, verifies conflicts with targeted MCP reads, and answers in plain Korean with a docs-vs-code evidence table. The audience defaults to non-developer and switches per question to a developer style when the question is developer-oriented.
---

# Platty MCP Hybrid QA

**Prerequisite:** Read `using-platty-mcp` before acting unless it has already
been read in this turn.

Answer business questions for readers who are not developers by splitting the
work in two: cheap, fast **collectors** gather verbatim evidence per question
and per track (business documents, source code), and one strong
**synthesizer** verifies the doubtful parts and writes the answer. Documents
give scope, vocabulary, and related rules; code gives exact behaviour, values,
order, and the endpoint that is actually called. Crossing the two is the only
reliable way to catch a document that describes an older API generation or a
screen-to-API link the document never stated.

This skill is the orchestrator only. The collectors climb the existing ladders:

- docs track → `platty-mcp-retrieval` (map-first ladder, evidence gates);
- code track → `platty-mcp-code-qa` (session setup, Evidence Ladder,
  Missing-Link Ladder, honesty levels).

Do not restate those ladders here; read them.

## When To Use

- A non-developer business or operational question ("what happens when…",
  "which state allows…", "what is the daily limit…", "what is deleted when…"),
  one at a time or as a list (a QA sheet, a customer question set).
- `context_status.documentAvailability` shows business documents, so both
  tracks can run; or business documents are absent and several questions must
  be answered from code (code-only mode, parallel code collectors).
- Change-impact, regression-scope, bug-cause, A-to-Z chain, and direct data
  edit questions asked as business questions, alone or inside a QA list: answer
  them here with the Impact Questions section (impact sweeps S1–S7); do not
  route them away.

## When Not To Use

- Exact ID / route / file lookups or term definitions: `platty-mcp-retrieval`.
- A standalone engineering impact request that needs an Impact Dossier
  (Impact Seed Packet, `impactRevision`, cross-EPIC traversal, SDD §9) or a
  design-change packet: `platty-mcp-impact-analysis`. Impact questions
  inside a QA list, or asked as business questions, stay here and run the
  impact sweeps.
- SDD packet requests (`routeMode: seed-only`) and SDD file authoring: the SDD
  skills.
- A single question in code-only mode with no sub-questions: run
  `platty-mcp-code-qa` directly; orchestration adds nothing.
- Setup, analysis, sync, generation, mutation, or Memory writes.

## Boundary

Use only configured Platty Enterprise MCP tools. Never use local CLI, local
project files, or a host shell, and never execute project code. Collectors and
the synthesizer inherit the secrets rule of `platty-mcp-code-qa` (never read or
quote credential files; mask credential-looking values). Answers are returned
in the conversation; this skill writes no files unless the user explicitly asks
for one (for example an answers file). Then only the main session writes that
file; collectors and the synthesizer never write.

## Runtime Modes

The job split and the JSON schema are identical in every runtime; only the
execution differs.

| Runtime | Collectors | Verify and Answer |
| --- | --- | --- |
| Claude Code (subagents available) | plugin subagents (Sonnet, low effort) | main session when Opus class, else the plugin synthesizer (Opus, high effort) |
| Codex with multi-agent (`spawn_agent`, `wait_agent`, `close_agent` all available) | native `spawn_agent` workers, Luna-class model | SOL-class worker, or the main session when it is already SOL/Astra class |
| Codex without multi-agent (any of the three missing), or any runtime without model-selectable subagents | sequential in-session jobs | in-session |

- **Claude Code (subagents available):** dispatch collectors as plugin
  subagents `platty-mcp:platty-evidence-collector-docs` and
  `platty-mcp:platty-evidence-collector-code` (Sonnet, low effort). Run the
  Verify and Answer steps in the main session when it is a strong model
  (Opus class); otherwise dispatch `platty-mcp:platty-qa-synthesizer` (Opus,
  high effort) with every collector result, the Session Card, and the resolved
  audience of each question (`Q<n>: non-developer | developer`).
- **Codex with multi-agent support (`spawn_agent`, `wait_agent`, and
  `close_agent` are all available):** native mode needs the complete worker
  lifecycle, so check all three tools before choosing it; when any of the
  three is missing or unavailable, use the sequential in-session fallback
  below. Dispatch each collector job as its own native worker with
  `spawn_agent`, one worker per Job Card, using the Luna-class model at
  `xhigh` effort (the owner's convention for workers; role:
  mechanical evidence collection).
  - Spawn every worker with `fork_turns: "none"` and explicit `model` and
    `reasoning_effort` arguments. The Codex default `fork_turns: "all"`
    rejects model and effort overrides and would hand the worker the whole
    session, including the full guide and earlier opposite-track results,
    which breaks collector isolation.
  - Because nothing is forked, the spawn prompt is fully self-contained:
    the Job Card, its Guide Brief, the collector JSON contract
    (`references/collector-contract.md`), and the matching
    `platty-mcp-retrieval` or `platty-mcp-code-qa` ladder reference, all
    inline (a worker cannot read what only the session saw). Collectors
    must not write files or call mutation tools (Memory requests, alias
    writes, local CLI, host shell, project execution): the Claude Code hook
    does not apply in Codex, so state this read-only rule inside each spawn prompt.
  - Run up to 6 concurrent workers with rolling dispatch, collect results
    with `wait_agent`, and free every finished slot with `close_agent`; back
    off on `CONTEXT_UNAVAILABLE` clusters as in Collect.
  - Run Verify and Answer in a SOL-class worker (judgment role), or in the
    main session when it is already SOL/Astra class. Spawn the synthesis
    worker with `fork_turns: "none"` too, with explicit `model` and
    `reasoning_effort`, and pass it explicitly the collector results (JSON),
    the Session Card, and the resolved audience of each question as a
    `question → audience` list, plus the verify and answer instructions it
    needs; it does not inherit them from a forked context.
  - Record the exact model and effort used per job (and for the synthesis
    step) in the run notes. Model labels are role preferences: check
    availability before dispatch, and when the preferred model is unavailable
    record the substitution (requested, served, reason). A user-requested model
    needs the user's approval before it is substituted.
  - An external model CLI is never an automatic fallback. A failed or
    unavailable native worker is re-dispatched once, then run in-session
    (see Collect); never silently fall back to an external CLI.
- **Codex without multi-agent support (not the full lifecycle: any of
  `spawn_agent`, `wait_agent`, `close_agent` missing) and other runtimes
  without model-selectable subagents:** run the same jobs sequentially
  in-session, in the same order, each one producing the
  same JSON schema from `references/collector-contract.md` before the next job
  starts. Finish one track's job for a question and write its JSON before
  starting the other track, and do not let the first track's findings fill
  claims in the second: the tracks must stay independent so the cross-check
  can find errors. Then run Verify and Answer in-session. A runtime that offers
  parallel subagents without model choice may still run collectors in
  parallel with the session model.

## Session Setup

Run once per session, before planning:

1. Tool names: read the host's `tools/list` and record the exact names,
   including any server prefix (for example `platty_route_resolve` for
   `route_resolve`). Pass this prefix map to every collector; never call bare
   names blindly.
2. `projectId`: an opaque ID. When the user did not name a project, omit
   `projectId` on `context_status`: the server uses its default project (the
   Platty CLI's current project, or the only project you can read). Do not
   call `project_list` first. Call `project_list` only when that call returns
   `INVALID_INPUT` naming `projectId` (no default is set; the operator can set
   one with `platty project use <id>`), or when the user asks which projects
   exist. When only a project name is known, call `project_list` once and pick
   the returned `id`.
3. `context_status(projectId)` — it echoes the `projectId` it used; record
   that ID and pass it explicitly to every later call and collector. Record
   `documentAvailability` and per-tool availability. Decide the tracks once:
   - any of `br`, `ucl`, `design`, `data_dictionary` > 0 (business documents
     present) → **docs + code** hybrid: every question gets both tracks;
   - all four at 0 → **code-only**: code collectors only;
   - the user explicitly asks for a code-only answer → **code-only** even when
     documents exist; every answer then carries the `platty-mcp-code-qa` line
     under 추가 확인 필요 that the business documents exist (per-family
     counts) and were not consulted.
   Technical spec counts (`api_spec`, `screen_spec`, …) do not change the
   decision; the docs collector still reads them when they exist.
4. **Code environment guide.** The operator writes one guide per project
   (repo map, routing rules, layer conventions, recipes, noise and credential
   paths, mirror or duplicate systems, and appendices such as status or
   message-code dictionaries and menu → screen → API → SQL tables). Read it
   with `code_search_guide_get(projectId)` fully — all pages, replaying
   `pageInfo.nextCursor` until no page remains (pages are about 60,000
   characters; an `INVALID_CURSOR` means the guide changed mid-read, so start
   again from the first page). Read it once per session, here in the
   orchestrator; collectors do not re-read the whole guide, they receive a
   per-job Guide Brief (see Plan).
   - From it build the code-qa Session Map: repo roles and ownership, repo sets
     with `repoId`s (`workspace_repo_list`), the negative-glob exclusion set
     (noise and credential paths), and which route tools (`route_resolve`,
     `route_relations`, `route_code`, `route_text_links`, `code_routes`) are
     listed. Follow `platty-mcp-code-qa` Session Setup for the details.
   - Index the guide by section heading so Plan can cut briefs from it.
   - `available: false` (no guide registered): proceed — derive repo roles from
     `workspace_repo_list` names as `platty-mcp-code-qa` describes — and record
     the gap: say "코드 환경 가이드 미등록" once under 추가 확인 필요 of the first
     answer, and recommend that the operator register a guide (see the plugin
     README, "Registering a code environment guide").
5. Write the **Session Card** that every job receives (`projectId` is the
   ID `context_status` echoed, so every job reads the same project):

   ```text
   projectId: <opaque id>
   tools: <bare name → host name map>
   tracks: docs+code | code-only (<reason>)
   documentAvailability: br <n> / ucl <n> / design <n> / data_dictionary <n> / specs <n>
   session map (code): repo sets + repoIds, exclusion globs, route tools listed
   guide: available (<sha256 prefix>, <totalChars>) | not registered
   ```

## Plan

Split the request into jobs: one job per **question × track**.

- Number the questions (`Q1`, `Q2`, …) and keep the raw wording.
- A large question that bundles several independent asks (for example "the
  order of steps, what is created, and who is notified") may be split into
  sub-questions (`Q2.1`, `Q2.2`, …); each sub-question is again × track. Keep
  sub-questions disjoint so two collectors do not chase the same evidence.
- Cut a **Guide Brief** per job: copy only the guide sections relevant to
  that question and track, verbatim and labelled with their section heading —
  - repo roles and ownership for the question's domain;
  - layer conventions (screen naming, how a screen calls the server,
    controller → service → data-access → SQL layout);
  - the matching recipe for the question type;
  - noise and credential exclusion globs;
  - mirror or duplicate-system rules (which copy is authoritative);
  - the relevant appendix rows only (for example the status or message codes
    and the menu → screen → API → SQL rows the question names).
  A docs job needs only vocabulary and appendix rows; a code job needs the
  rest. Never paste the whole guide; when no guide is registered the brief is
  "not registered".
- Each job gets a **Job Card**:

  ```text
  job: Q<n>[.<k>]-<docs|code>
  question: <raw question or sub-question>   parent: <raw Q<n> when split>
  track: docs | code
  audience: <non-developer | developer> (decided per question, see Audience)
  business words: <menu, button, state, message, document names from the question>
  link: <impact link jobs only: db | job/event | client | settlement | notification/external>
  sweeps: <impact jobs only: the sweeps this job owns, e.g. S1, S2>
  Session Card: <as above>
  Guide Brief: <relevant guide sections for this job, each headed "guide:<section>">
  ```

- Business words in a docs Job Card come from the question and earlier
  docs-track results only; never copy identifiers the code track found (status
  names, file or API names) into a docs Job Card, or docs claims into a code
  Job Card.

## Audience

The answer **audience is decided per question**, before collectors are
dispatched, and recorded in every Job Card of that question (`audience:`).
Collectors always return the same evidence JSON (they may echo `audience` from
the Job Card; they never decide it); the audience only shapes the Answer step.
The orchestrator passes the **resolved audience of every question** (including
a list-wide "비개발자용" / "개발자용") to the synthesizer explicitly, as a
`question → audience` list next to the numbered questions, because the
synthesizer does not receive Job Cards.

- **Default: non-developer.** Plain Korean business wording, uncertain points
  presented as candidates or hypotheses with what would confirm them, and the
  developer evidence collapsed at the end.
- **Developer** when the question is developer-oriented. Signals:
  - code identifiers in the question: file, class, or method names, API paths,
    table or column names, query ids, stack terms;
  - developer phrasing: "어디를 고쳐야", "쿼리", "API", "리팩터", "소스 코드",
    "코드 어디", "서버 로그", "배포 시", or the user saying "개발자용".
  - Bare "코드", "로그", "배포" alone are not signals: operational questions use
    them too ("승인 코드가 무슨 뜻인가요?", "로그인 로그가 남나요?", "배포된
    쿠폰"). Switch on these words only with 기술 맥락 (technical context): code
    identifiers, file/class/API/table names, or a phrase above. Otherwise keep
    the non-developer default. Example: "승인 코드가 무슨 뜻인가요?" stays
    non-developer; "승인 코드 어디서 만드는지 코드 어디 봐야 해?" is developer.
- An explicit user instruction ("비개발자용" / "개발자용") overrides detection,
  for the whole list or for the named question.
- Decide per question: one QA list can mix both audiences. When the signals
  are absent or conflict, keep the default.
- State the chosen audience in one short line at the top of each answer
  (`> 대상: 비개발자용` or `> 대상: 개발자용 (<판정 근거 한 줄>)`).

The audience changes presentation only. Honesty levels, the evidence table,
the verification rules, and the impact sweeps are identical for both.

## Impact Questions

Change-impact ("what breaks if we change W"), regression-scope, bug-cause,
A-to-Z chain ("from X to Z, what happens, and what changes if ..."), and
direct data edit questions are answered here, inside the QA list, with both
tracks plus the impact sweeps. Audits of earlier runs found these answers
directionally right but missing five to eight real consumers per chain: other
writers of the same table, batch jobs, literals inside SQL templates, webview
copies of a screen, request-direction codes, and fall-through branches. The
sweeps are mandatory for these question types; the generic how-to for each is
in `platty-mcp-code-qa` `references/code-qa-recipes.md`, "Impact Sweeps
(S1–S7)".

Each sweep ends either done, with its coverage (patterns, name forms, repos,
per-repo status), or listed as partial with what is still open. Every sweep
appears in the answer's 점검 sweep 현황.

- **S1 Same-table and same-model writers and readers** across ALL repos: search
  the ORM model name, the mapped table name, and the raw SQL and query-builder
  string forms (camelCase, snake_case, and plural variants). List every writer
  and reader; never filter to the first few hits or to the ones that share the
  changed rule.
- **S2 Enum, type-code, and status literal sweep**: every usage of the affected
  values as identifiers AND as string literals (SQL templates, query-builder
  conditions, configuration, client code), including request DTOs, bodies, and
  paths that clients send with the value; old clients keep sending the old
  value after a renumbering or rename.
- **S3 Job and event inventory** for the domain: `route_resolve` with
  `kinds: ["job", "event"]` and the domain words, plus `workspace_search` for
  the scheduler and listener decorators or registrations the guide names. List
  the scheduled jobs, batch endpoints, and event emitters and listeners, and
  check each against the change.
- **S4 Client surface sweep**: every client (mobile app, webviews, admin web,
  seller or partner web, other repos), including native and webview copies of
  the same screen, logic, or constants. Search the backend's
  stakeholder-specific APIs for the entity first, then follow each route to its
  client; a client repo with no hit does not clear that stakeholder.
- **S5 Branch completeness**: when the changed condition gates a branch
  (`if (!x) continue` or `return`, fallbacks, default branches), read where
  the fall-through goes and what it does; "no target" is not "no effect" until
  the fall-through path is read.
- **S6 Idempotency, duplicate guards, and aggregations** that read the changed
  data: dedupe checks ("already granted"), counters, statistics, exports,
  reports, settlements.
- **S7 Close every open item**: each 미조회 / "not checked" / 문서만 row gets the one
  search or read that would settle it, or is marked partial explicitly with the
  reason.

Link-focused jobs for A-to-Z and wide impact questions: in addition to the docs
and code tracks, split the question into link-focused collector jobs (code
track, `job: Q<n>.<link>-code`), each running one sweep deeply rather than the
whole question:

- DB writers and readers (S1, S2);
- jobs, events, and batches (S3, S5);
- clients and screens (S4, and S2 in the request direction);
- payments, settlement, and payout (S6 and the money flow);
- notifications and external systems (S3 emitters, S5 fall-through messages).

Each link job returns claims tagged with `link` and its `sweeps` coverage
(`references/collector-contract.md`). The ordinary docs and code jobs still
cover the main flow. The synthesizer merges the link results into one
영향 체인 지도 (chain map): one row per affected link with its level,
duplicates merged, and every partial sweep carried into 점검 sweep 현황.

## Collect

Dispatch every job of the plan **in parallel**: on Claude Code, issue all
collector Agent (Task) calls in a single message, one per Job Card, with
`subagent_type: "platty-mcp:platty-evidence-collector-docs"` for docs jobs and
`subagent_type: "platty-mcp:platty-evidence-collector-code"` for code jobs. On
Codex with multi-agent support, issue one `spawn_agent` per Job Card
(`fork_turns: "none"`, explicit `model` and `reasoning_effort`, self-contained
prompt) as described in Runtime Modes, then `wait_agent` for results and `close_agent`
each finished worker so its slot frees for the next job. For
a long QA list, run up to 6 concurrent collectors (the tested shape; a ceiling,
not a target), never serially by default. Rolling dispatch is fine: start the
next job whenever a slot frees instead of waiting for a whole wave. When
results report `CONTEXT_UNAVAILABLE` or timeouts in clusters, back off: lower
the concurrency (for example to four) and re-dispatch only the jobs whose
results are missing.

- The docs collector follows the `platty-mcp-retrieval` ladder (map-first, exact
  item reads, specs) and does not read source code.
- The code collector follows the `platty-mcp-code-qa` ladder, including the
  Missing-Link Ladder, and does not read business documents.
- Collectors work independently: never feed one track's result into the other
  track's job. Independence is what lets Verify detect errors.
- Same-track reuse across questions is allowed: a code job for a later question
  may receive file or route leads from an earlier code job (a docs job from an
  earlier docs job), labelled "verify, do not trust"; the collector re-reads a
  lead before citing it. Leads are never passed cross-track.
- Put the Job Card, including its Guide Brief, inside each collector's
  dispatch prompt. The brief saves every collector from re-reading the whole
  guide; a collector calls `code_search_guide_get` only when its brief is
  insufficient, and says so in `gaps`.
- Each collector returns ONLY the JSON object defined in
  `references/collector-contract.md`.

On return, parse every result. A malformed or failed result: re-dispatch that
one job once; if it fails again, run that job in-session with the same
contract. Never silently drop a track — a missing track is named in the answer.

## Verify

The synthesizer (main session or `platty-qa-synthesizer`) checks evidence
before writing anything. It uses targeted MCP reads (`readonly_workspace_shell`
`sed -n`/`rg -n` on the cited file, `<family>_item_get`, `spec_get`) — one
question-relevant read per open item, not a fresh investigation.

Verify, at minimum:

1. Every docs↔code conflict (different value, order, state, endpoint, or
   created record for the same item): resolve it with a targeted MCP read of
   the code line and, when needed, the document item.
2. Every 확인됨 claim whose quote does not directly support it (quote cut off
   before the asserted part, a summary instead of verbatim text, a different
   subject, evidence marked unresolved, or a link the quote never states):
   do a targeted re-read; if the read does not confirm it, downgrade it to
   근거상 보임 or 불가.
3. Every absence claim marked 확인됨 ("no API for X", "never deleted"):
   downgrade it to 근거상 보임. An absence is only ever stated as
   "검색 범위에서 찾지 못함" with the searched scope (tools, patterns, repos or
   families, status). A `complete` search status does not make an absence
   확인됨; it only makes the searched scope exact (same rule as the collector
   contract and `platty-mcp-code-qa`).
4. Line drift: when a re-read shows the cited line moved, cite the verified
   line number; the claim stands if the text matches.
5. Impact questions: before accepting a chain-map row that says "no target",
   "no effect", or "not checked", run the S5 fall-through read or the S7
   closing search; otherwise the row stays partial.

Precedence when the tracks disagree:

- Code wins for exact behaviour, values, order, conditions, and created or
  changed records — but only where the code track actually read that path or
  branch. A path the code track did not read keeps the docs claim as 문서만
  (or 미해결 when the two cannot be reconciled without more reads).
- Docs win for scope, vocabulary, related rules, cross-cutting policies, and
  which other features the question touches.
- Legacy versus current: when a document describes a legacy endpoint or API
  generation (v1, v1.1, …) and the code reads a current one (v2, …), do not
  call it a plain conflict. Check which endpoint the current client calls (the
  screen or app call site) with a targeted read, answer with the current
  behaviour, and flag the difference as 버전 차이 under 주의.
- The code environment guide disambiguates; it does not prove behaviour. Use
  its rules to settle ownership (which repo or system owns the path), routing
  (which server handles a URL prefix), and mirror or duplicate systems (which
  copy is authoritative) when collectors cite different repos for the same
  item. A claim backed only by `guide:<section>` refs is a guide-only fact:
  keep it at 근거상 보임 at most and list guide-only facts separately from the
  docs-and-code rows in the answer.
- Never invent beyond evidence: an item neither track proved stays under 추가
  확인 필요, with what was searched.

Record each correction (collector, claim index, what was wrong, how it was
verified) for the collector-quality note.

## Answer

Write one block per question with `references/answer-template.md`, using the
non-developer template or the Developer Template according to that question's
`audience` (see Audience), with the audience line first. Non-developer order:
한 줄 결론 →
쉬운 설명 → 주의 / 예외 → 추가 확인 필요 → 근거 표 (항목 | 문서 근거 | 코드 근거
file:line | 일치), using the plain Korean rules of `platty-mcp-code-qa`. In
code-only mode the 문서 근거 column says "문서 없음" or "참고하지 않음".

Impact questions (see Impact Questions) add the 영향 체인 지도 and the
점검 sweep 현황 checklist after 쉬운 설명. The 7-step and 4-caveat caps
do not apply to impact answers: list every link and caveat the evidence
supports. The "affected" column stays in business words; API paths and job
names go in the 근거 column so developers can still recognise them.

When Verify corrected any collector claim, add a short 수집기 품질 note
(which collector, how many claims, what was corrected and how). Batch answers
put shared evidence in the first block; later blocks say "근거: Q<m> 참고".

## Completion Criteria

There is no per-question call or time budget: quality decides when a question
is done.

- every job of the plan returned a valid JSON result (or its failure is named);
- every claim used in an answer is 확인됨, or classified 근거상 보임 / 불가 with
  its reason or searched scope;
- every docs↔code conflict and every weak 확인됨 has been verified or
  downgraded;
- every 버전 차이 states which version the current client calls, or names
  that as 추가 확인 필요;
- impact questions: each impact sweep S1–S7 is done with its coverage or named
  partial in 점검 sweep 현황, and every 영향 체인 지도 row has a level.

Loop guard: collectors and the synthesizer use the loop guard of
`platty-mcp-code-qa` — never repeat an identical search (same tool, pattern,
repos, globs, cursor, filters); progress means a new candidate, a verified
link, or an eliminated hypothesis; after three consecutive different searches
add nothing new for an open item, conclude it honestly and name the next check.
The loop guard never skips mandatory ladder steps or known unchecked
candidates.

## Red Flags

| Thought | Correct action |
| --- | --- |
| "Docs say it errors when the limit is reached; that's the answer." | Check which API generation the doc describes and which one the client calls; flag 버전 차이. |
| "The doc lists the approval API, so the list button calls it." | A screen→API link needs the call site; the docs collector puts unstated links in `gaps`. |
| "One strong agent can do both tracks faster." | Split per question × track; independence is what catches errors. |
| "The code collector said 확인됨, ship it." | Check the quote supports the claim; re-read or downgrade. |
| "Nothing found, so it is 확인됨 that it does not exist." | Absence is 근거상 보임 with scope, never 확인됨. |
| "Code wins, so drop the docs rule." | Code wins only where it read that path; keep unread branches as 문서만. |
| "This runtime has no subagents, so skip the docs track." | Run the same jobs sequentially in-session. |
| "Codex has `spawn_agent`, but a CLI model is faster, so shell out to it." | An external CLI is never an automatic fallback; use native workers, and record any model substitution in the run notes. |
| "I'll fill the gap with what the system probably does." | Never invent; put it under 추가 확인 필요. |
| "Send every collector the whole guide to be safe." | Read it once in setup; pass each job only its Guide Brief. |
| "The guide's appendix says code '21' means approved, so 확인됨." | Guide-only facts are 근거상 보임; a code label or constant does not confirm the meaning either. Only a read data row defining the code does; otherwise tag [DB]. |
| "Everyone reading is probably a business person, so use the plain template for every question." | Decide the audience per question; developer-oriented questions get the Developer Template. |
| "No guide registered, so stop." | Proceed from repo names; note the gap and recommend registering a guide. |
| "This is an impact question, so route it to impact-analysis even inside the QA list." | Stay here and run the impact sweeps; impact-analysis is for Impact Dossiers. |
| "The batch finds no target after the change, so no effect." | S5: read the fall-through branch; a skipped row often lands in a default branch that does something else. |
| "The first five hits show the writers of that table." | S1: list every writer and reader across all repos, in every name form. |
| "The app screen row is done." | S4: check webview copies and every other client (admin, seller or partner web). |
| "The client repo has no match, so that stakeholder is unaffected." | S4: search the backend's stakeholder APIs first, then follow each route to its client. |
| "Clients only display the code, so renumbering needs only an app release." | S2: check the request direction; old clients keep sending the old code. |

## References

- `references/collector-contract.md` — Job Card input, JSON output schema
  (including `link` and `sweeps`), level rules for both tracks, tool input
  rules.
- `references/answer-template.md` — per-question template with the docs-vs-code
  evidence table, the 영향 체인 지도 and 점검 sweep 현황 for impact questions,
  and the collector-quality note.
- `references/pressure-scenarios.md` — load only when validating or changing
  this skill.
- Agents (Claude Code): `agents/platty-evidence-collector-docs.md`,
  `agents/platty-evidence-collector-code.md`, `agents/platty-qa-synthesizer.md`
  at the plugin root.
- Codex multi-agent dispatch: `using-platty-mcp/references/tool-mapping.md`,
  "Codex multi-agent dispatch".
