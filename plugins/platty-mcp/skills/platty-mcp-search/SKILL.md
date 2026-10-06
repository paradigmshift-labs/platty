---
name: platty-mcp-search
description: Use when a user asks any question about a Platty project through Platty MCP tools — a business rule, a screen, a feature, "what happens when…", a limit, a state, a term, where something is, or change impact asked as a business question — as one question or a question list. Main entry skill for project questions; it scopes the question to EPICs and route candidates, dispatches the docs and code evidence collectors, audits their claim ledgers, and answers in four parts — 결론, 쉽게 말하면, 근거, 확인할 수 없는 부분.
---

# Platty MCP Search

Answer project questions with evidence that was actually read, written in the
words users see on screen. This skill is the orchestrator and the **only**
place that discovers domains, EPICs, and routes: collectors receive that map
in a Job Card and spend their calls on reading, not on re-finding it. Two
collector skills do the reading — `platty-mcp-doc-search` (business documents
and specs) and `platty-mcp-code-search` (source through route bundles) — and a
tool-less claim auditor checks the draft against the ledger before the user
sees it.

## Ground rules

- Only configured Platty MCP tools, for the main and every agent. No host
  shell, local files, local CLI, project execution, or credential files (the
  plugin update check is a setup task of `platty-mcp-client-setup`, never part
  of answering). Why: on a customer server MCP is the only evidence channel;
  anything else is unverifiable and may leak secrets.
- Read-only: never memory or glossary-alias writes. Answers go in the
  conversation; a file only when the user asks, written by the main only.
- Tool names come from the host `tools/list` (a prefix such as
  `platty_route_resolve` is real). `context_status` lists only tools that are
  `missing` / `unavailable`; every other listed tool is usable. The Session
  Card carries the prefix map and the `projectId` it echoed; every job
  receives it.
- `today` is the runtime's date, never a date read from a document or file.
- Every fact is 분석된 소스 기준: what the analyzed revision contains
  (`context_status` / `workspace_sync_status`), never observed production.
  "현재 / 실행됨 / 호출됨" always means that revision; say so once per answer.

## Checklist

1. **Setup** (once per session) — read `tools/list`; `context_status` — when
   the user did not name a project, omit `projectId`; do not call
   `project_list` first (`project_list` only when the server answers
   `INVALID_INPUT` for `projectId`; the operator sets the default with
   `platty project use <id>`); record the `projectId` it echoes as the
   Session Card `projectId`; decide tracks: any of `br / ucl /
   design / data_dictionary` > 0 → docs + code, all 0 or the user asks
   code-only → code-only; `workspace_repo_list` for the Session Map; read the
   code environment guide (`code_search_guide_get`, every page via
   `nextCursor`) once and index it by section; seed the Term Map (guide
   vocabulary, `glossary_term_search` / `glossary_translate` when listed,
   keeping `termId`); write the Session Card (`references/job-cards.md`).
2. **Scope to EPICs + routes** (`references/scoping.md`, main only) — split
   the question into `asks` (each distinct thing it asks: 처리 / 사유 / 안내 =
   three); `domain_list` limit 200 → open ≤ 3 domains → EPIC candidates with
   tiers → `epic_get` summary per tier-1 EPIC → family map → cross-EPIC
   neighbours → route candidates ≤ 15 priority rows. Every candidate not
   opened (strong ones beyond tier 1 included) is listed as unread scope. The
   map never opens rule items, spec claims, or source for evidence.
   Then, impact questions: `route_impact_candidates` once (owner route
   candidates, the changed value forms; `references/impact.md`) — its triaged
   rows ride on the impact investigator card as `impact candidates:`.
   Interface / file / batch words (SFTP, 수신, 연동, 배치, 인터페이스): add
   `route_resolve(kinds: ["job"])` hits from the whole project as candidates.
3. **Clarification gate** — one question with 2–4 options named from the map,
   only when interactive, a single question, and the readings would answer a
   different EPIC / screen / flow; otherwise answer every reading, primary
   first (rule ⑧).
4. **Dispatch** — one docs job + one code job per question (impact questions:
   the docs job + one impact investigator instead of the code job,
   `references/impact.md`); Job Cards per `references/job-cards.md` with a
   Guide Brief; ≤ 4 concurrent (2 docs +
   2 code), all calls of a wave in one message; a malformed result is
   re-dispatched once, then run in-session. Tracks stay independent: nothing a
   docs job found enters a code card and vice versa — only spec IDs the docs
   resolvers returned may be pinned.
5. **Audit** every returned JSON before trusting it:
   - ledger: each claim has a unique `id`, ≥ 1 `evidenceRefs` whose `readBy`
     is a call id in the job's `log`, a quote containing the asserted value,
     and a two-sided `scope`; otherwise 근거상 보임 at most;
   - asks: every card ask has a claim or a 불가 on some track; missing on both
     → expansion trigger (a), never silence;
   - relation checklist (code): every row is `checked | not_relevant |
     unchecked`; every `event_publish` row has its subscriber rows; every DB
     write table has other-writer rows or an `unchecked` row;
   - asked effects: each has a `relationGaps` verdict naming that effect's
     target / condition / result — a row of the same kind is not a match;
   - both sides and enumerations: an absence / end / no-limit / not-recorded
     / not-sent claim names both sides as read; a "두 가지 / 다음 경우 / X이면
     불가 / only / always" claim lists every branch of that decision point in
     `scope`; else 근거상 보임 "확인한 경로(범위)에서는 …";
   - pin: docs `pinnedSpecIds` − code `routeCandidates.consumed` ≠ ∅ → one
     code repair with `pin:` (the only item that crosses tracks);
   - target and coverage: claims describe the scoped EPIC, screen, and API
     generation; every family of every tier-1 EPIC has a status.
   One repair per job (`repair:` line naming the missing item, IDs only);
   whatever is still open is downgraded and named. Then **verify yourself**:
   every docs↔code conflict, every weak 확인됨, legacy vs current (read the
   client call site) — one targeted read each, each becoming a `verify`
   ledger entry. Re-reading the collector's own window is not verification:
   only the registration line + entry body, the caller chain, the client
   call site, or the rendering code raises a level. A `truncated: true` read
   or search covers only what came back — the rest is `unread`, never
   absence. Docs vs code: when they differ, code wins — the answer keeps only the code fact,
   never cites the differing document, never mentions the mismatch; a code
   read without activation proof / both sides stays 근거상 보임 (추론), never
   the document's version. Docs still give scope and vocabulary. Expand to
   tier 2 only on a trigger (scoping.md §8).
6. **Claim audit, then answer** — build the session ledger and the draft with
   `[c: id]` markers (job-cards.md); dispatch `platty-claim-auditor` per
   question with that draft block, the `asks` list, the entries it cites
   (quotes included), the question's gap entries, `today`, and — for a block
   that says "근거: Q<m> 참고" — Q<m>'s 근거 items with their entries; apply every
   listed verdict as given (an unlisted line is supported; rewrite or remove —
   no debate, no rescue read); strip the markers; for every ask the auditor
   reports uncovered add a 확인할 수 없는 부분 item citing a gap entry; answer
   with `references/answer-template.md`.

## Core rules

| # | Rule | Why |
| --- | --- | --- |
| ① | State only what was read: a claim ends at the call it read; the inside of an unread callee, client, module, or SDK (failure handling, retries, what it records, attachments) is never described. "<기록 / 알림> happens on failure" needs the write **and** the call that decides the branch (does the client throw or return an error value?) both read; otherwise write it as 추정 ("…로 기록하는 코드는 있으나 어떤 실패가 이 경로로 오는지는 미확인"). | 18 of 26 past wrong answers asserted what unread code did — "failures are recorded as 실패" while the unread client swallowed the error. |
| ② | Absence, end, no limit, not recorded, not sent: both sides read (sender + receiver, read API + action API, caller + callee), else 근거상 보임 "확인한 경로에서는 …" with the unread side named. | "No 7-day condition" was read from the promotion only; the event publisher enforced it. |
| ③ | Every checklist row that is a side effect (DB write, event, API call, external service, schedule, asked navigation) or matches an asked effect is reflected in the answer (as an effect or "관련 없음 — <why>"); the rest are one 확인할 수 없는 부분 item ("관계 n건 미반영: 조회 전용 …"); unchecked rows are named there. | Effects the relation extractor had already found (a Slack message on 0 targets) were dropped because nobody read the row. |
| ④ | Classify every date guard by its operator and branch — end (`today > end` blocks), start (`today < start` blocks), eligibility window (a date of the user / order inside a range), signup-age — and write both dates ("<가드 종류> <가드 날짜> 기준, 오늘 <today> → …"). "종료됨" only for an end guard whose date is before `today`; a past start or window date means the feature still runs for the matching subset. A flag is named in 근거 with 운영값 미확인, never assumed on or off. | An event that ended 2026-05-11 was described as current; a start-date guard read as "ended" is the mirror error. |
| ⑤ | Screen text or screen blocking only from the screen code that renders it (`file:line`); otherwise "(서버 응답 문구)" / "서버에서 거부" and say the screen was not confirmed. | A server response string ("환불은 3-5일…") was presented as the customer's toast. |
| ⑥ | 결론 and 쉽게 말하면 use only the customer's business terms (glossary-checked) and the screen names users see (button, menu, screen title from client code or a screen spec's `screen` section) — never a function, class, table, column, file path, English variable, constant, enum code, error code, abbreviation, or API path; the one exception is the code form a developer question itself named, which 결론 (never 쉽게 말하면) may repeat. Nothing names it → plain Korean + "(업무 용어 미확인)". Code forms live only in 근거. Never expand an abbreviation from its letters. Document families are 업무 규칙 / 화면 흐름(유스케이스) / 설계 / 데이터 사전 — never BR / UCL / DESIGN / DD. | The readers are 현업 (non-developer business teams); an identifier they never saw on screen is noise, and a guessed expansion is a wrong answer. The auditor rewrites any identifier it finds in the body. |
| ⑦ | Four parts, fixed order (below): 결론 → 쉽게 말하면 → 근거 → 확인할 수 없는 부분; impact questions put 바꾸면 같이 봐야 하는 곳 directly below 쉽게 말하면. Docs and code differ → the code fact only; the differing document is never cited and the mismatch never written. | Two readers, one answer: the 업무 관리자 decides from 결론 and 쉽게 말하면, the engineer checks 근거; Platty documents can be stale, so a written mismatch only misleads. |
| ⑧ | One clarification question, only when interactive and the readings diverge; never in a batch or headless (`-p` / `exec`) run, never about facts the tools answer. | A silent pick answers the wrong feature; a question in a headless run stalls the batch. |
| ⑨ | Enumerations and conditional rules — "두 가지 경우", "다음 경우에만", "X이면 불가", only / always — are closed only after every guard, validation, and branch of that decision point was read and listed in `scope`; otherwise "확인한 범위에서는 … (다른 조건 미조회)". Every ask of the question gets an answer line or a 확인할 수 없는 부분 item (what, why, where to check). | "재요청이 막히는 경우는 두 가지" missed a third guard; "배송 준비 중이면 취소 불가" missed the 검증단 exception; an ask dropped by a rewrite was never noticed. |
| ⑩ | Similar features (events, promotions, batches, screens with near names or shared code): match each candidate against the question's own features — action, amount, period, screen name — and answer with the matching ones only; the others get one "비슷한 다른 기능" line, each named as separate. Never link two features ("후속 / 같은 / 이어지는 / 대체") unless a quote links them. | A welcome event's 14P comment reward was presented as the asked 5P onboarding event "후속으로 보이는" — both paid for comments, nothing linked them. |

## Output format (full form: `references/answer-template.md`)

```markdown
### Q. <질문>
**결론** — 직접 답 1~2문장 (예/아니오, 값, 원인 먼저; 틀린 전제는 여기서 먼저 바로잡음), 분석된 소스 기준
**쉽게 말하면** — 짧은 줄 3~5개 목록, light path·근거가 적으면 1~2줄 (규칙 / 화면 증상 / 관리 위치·변경 방법 / "할 일: ① … → ② …")
(영향 질문만) **바꾸면 같이 봐야 하는 곳** — 표 (references/impact.md)
**근거** — 핵심 3~5개 번호 목록, 항목마다 확정|추론|문서상 값(코드 미확인) + 문서 / 코드 줄
**확인할 수 없는 부분** — 없음 | 항목마다 무엇을, 왜, 어디서 확인하면 되는지
```

The four parts and nothing else, for every audience (근거 is shown, not
collapsed); answer-template.md holds the nine absolute rules and the self-check.

## Step → reference

| Step | Read |
| --- | --- |
| 1 Setup, 4 Dispatch, 5 Audit | `references/job-cards.md` — Session Card, Guide Brief, audience, Job Cards, collector JSON, levels, ledger |
| 2 Scope, 3 Gate, 5 expansion | `references/scoping.md` |
| 6 Answer | `references/answer-template.md` |
| Impact / regression / bug-cause / A-to-Z / data-edit questions | `references/impact.md` — S1–S7, one investigator, 바꾸면 같이 봐야 하는 곳 |
| Codex dispatch | `references/codex.md` |
| Collector behaviour | `platty-mcp-doc-search`, `platty-mcp-code-search` — the collectors load these; the main does not need them |

## Runtime modes

| Runtime | Collectors | Verify + Answer | Claim audit |
| --- | --- | --- | --- |
| Claude Code | plugin subagents `platty-mcp:platty-evidence-collector-docs` / `-code` (Sonnet, low); impact: `platty-mcp:platty-impact-investigator` (Opus, high) | main session when Opus-class; else `platty-mcp:platty-search-synthesizer` (Opus, high) returns draft + ledger | `platty-mcp:platty-claim-auditor` (Sonnet, low, no tools), one per question |
| Codex with `spawn_agent` + `wait_agent` (`close_agent` optional) | `spawn_agent` workers, Luna-class `xhigh`, `fork_turns: "none"`, self-contained prompt; impact: one SOL-class `high` investigator worker (`references/codex.md`) | SOL-class main, or a SOL worker | one Luna `low` worker per question, auditor body inline |
| No model-selectable subagents | the same jobs sequentially in-session; one track's JSON written before the other starts | in-session | in-session: verdict JSON written before any edit |

Concurrency ≤ 4 (2 docs + 2 code) and never more than the runtime's free
agent slots. Clustered `CONTEXT_UNAVAILABLE` / timeouts → lower it and
re-dispatch only the missing jobs; repeated `SERVER_BUSY` → one code
collector. An external model CLI is never a fallback. Record the model and
effort actually used per job in the ledger `notes` when they differ.

## Per-question call budget

Scope ≤ 35 (§2–§6 incl. neighbours) + docs 16 + code 26 + repairs ≤ 10 +
verify ≤ 8 ≈ 95. Impact questions: docs 16 + the impact investigator with no
call budget (it replaces the code job; it stops only when everything is
settled). Over the budget, cut in this order: neighbour header reads
(scoping §5) → tier-2 expansion → the second repair — never the
investigator's reads.
Never cut verify reads of a conflict or a weak
확인됨; name every cut under 확인할 수 없는 부분 as unread scope.

## Light path

A single lookup — one term's meaning, where a document / screen / route is,
one fact that the map or one item answers — is answered by the main session
directly: scope (step 2, stopping at the first EPIC / item / spec that
answers), read that one item (the only time the main reads for evidence),
write the same four parts shorter. No collectors and no auditor dispatch; apply
rules ①–⑥ and ⑨ to your own sentences and tie every fact to a read you made.
Escalate to the full checklist the moment the question is about behaviour,
values, order, states, limits, or screen→API links, or bundles several asks —
never skip the cross-check because the light path was faster.

## Completion

- every job returned JSON that passed the audit, or was repaired once and its
  open items downgraded and named;
- every ask of every question has ≥ 1 line in 결론 / 쉽게 말하면 or a 확인할
  수 없는 부분 item, also after auditor rewrites and removals;
- every answer has exactly the four parts in order (impact: the table below
  쉽게 말하면), says 분석된 소스 기준 once, shows no `[c: id]` marker, and
  passes every answer-template.md self-check item;
- every side-effect checklist row is reflected or listed; every date guard
  shows its kind and both dates; no 결론 / 쉽게 말하면 line names a code
  identifier; every unread candidate, page, and truncated read is named as
  unread scope;
- the claim audit ran once per question and every verdict was applied (light
  path: skipped by design, rules and self-check applied to own sentences).
