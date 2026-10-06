# Answer Template

This is the user's answer standard and the source of truth for every answer
(light path, orchestrated, code-only, impact, any audience). A Platty MCP
answer has four parts and two layers for two readers: a 문과 업무 관리자 (are
the business rules right?) and an engineer (do the 근거 match the real code
and documents?). Headings and level labels stay in Korean exactly as written.

## Absolute rules

1. Collect the 근거 first; derive the plain explanation from them.
2. Every line of 쉽게 말하면 is backed by ≥ 1 근거 item; a line without
   backing is deleted. 근거 numbers are not shown in the body.
3. 쉽게 말하면 has no code identifier — no function, class, table, file path,
   English variable, constant, or error code. Business terms and screen
   names only.
4. Business terms in the customer's words: check code term ↔ business term
   with the glossary. Never invent a term and present it as the customer's.
5. No value, rule, time, or count that is not in the 근거. Unknown → 확인할
   수 없는 부분.
6. Documents and code differ → follow the code. Write only the code-based
   content; never use the differing document as 근거; never write that the
   document and the code differ (Platty documents can be stale).
7. Allowed-value lists, constants, thresholds, and error codes are 확정 only
   when read directly in code; seen only in a document → 문서상 값(코드 미확인).
8. A question about a fixed list, setting, or policy (choices, allowed
   values, fee rates, base amounts, permissions, …) must state, in 결론 or 쉽게
   말하면, where the value is managed (관리 화면 / 설정 데이터 / 프로그램 안) and
   what a change needs (화면에서 변경 / 개발 변경·배포); where the collectors did
   not find it, that goes under 확인할 수 없는 부분.
9. Periodic processing (batch, schedule): never assert when a change takes
   effect — "주기적으로 확인하며(설정상 N시간 간격), 실제 반영까지 걸리는 시간은
   보장되지 않는다". Per-run count limits and re-query conditions go in 근거.

## Output format

```markdown
### Q. <질문 원문>

**결론** — <직접 답 1~2문장: 예/아니오, 값, 원인 먼저> (분석된 소스 기준)

**쉽게 말하면**
- <왜 그렇게 동작하는지 (규칙)>
- <현업 화면에서 어떻게 보이는지 (증상)>
- <목록·설정 질문: 관리 위치와 변경 방법>
- 할 일: ① <근거에서 나온 구체 행동> → ② <…>

**근거**
1. <사실 한 줄> — 확정|추론|문서상 값(코드 미확인)
   — 문서: <문서 ID·항목 / 스펙 ID>
   — 코드: <repo/경로:시작줄-끝줄> — 요지: <조건·값·오류 코드 한 줄>
2. <…>
그 밖의 근거:
- <한 줄>

**확인할 수 없는 부분** — 없음
- <무엇> — <왜: 시스템 밖 / 실데이터 / 설정 / 문서에 없음 / 조회 실패> — <어디서 확인하면 되는지>
```

- **결론** — the direct answer in 1–2 sentences: yes / no, the value, or the
  cause first. A wrong premise is corrected here, first. Several candidate
  causes → the most likely one first. Never talk around the answer.
- **쉽게 말하면** — 3–5 short lines as a list, never a paragraph (light path
  or thin 근거: 1–2 lines, never padded): why it
  works that way (규칙) / how it shows on the 현업 screen (증상) / for a list
  or setting question, where it is managed and how to change it / when there
  is a problem and the 근거 yield an action, the last line "할 일: ① … → ② …"
  (otherwise omitted; never a generic line such as "담당자에게 문의"). A
  comparison question may use a 2–4 row table. At most one analogy. "보통 /
  대부분" only when the 근거 say so. Numbers exactly as in the 근거.
- **근거** — the 3–5 key items, numbered. 확정 = stated verbatim in the
  source; 추론 = several 근거 combined (name which ones). The "문서:" line only
  when that document's body really contains the fact; the "코드:" line only
  for the ≤ 3 key facts that decide the 결론 and only when actually read in
  code — code not checkable → no 코드 line, labelled 문서상 값(코드 미확인) or
  추론. No code text pasted — one-line
  values (constant values, error codes, error messages) verbatim. A document
  that differs from the code is never a source. Extra 근거 under "그 밖의
  근거:", one line each, ≤ 3.
- **확인할 수 없는 부분** — "없음", or per item: what, why (outside the
  system, real data, settings, not in the documents, lookup failed, …), and
  where to check it. Only the pieces left after everything answerable was
  answered; never cover the whole question with "확인 불가". Exception —
  nothing could be confirmed (every lookup failed, the question is outside
  the analyzed scope, every ledger entry is 불가): 결론 says plainly that it
  cannot be confirmed and why; 쉽게 말하면 and 근거 are "없음"; 확인할 수 없는
  부분 lists what was tried and where to check.

Labels come from the ledger levels by the mapping in job-cards.md Levels; a
불가 entry is never labelled, it becomes a 확인할 수 없는 부분 item.

## Self-check (fix, then send — every item must hold)

- 결론 answers directly and corrected any wrong premise;
- 쉽게 말하면 is a 3–5 line list (1–2 on the light path or with thin 근거), and "할 일:" is a concrete action from the 근거;
- 쉽게 말하면 has no code identifier, path, English variable name, or error code;
- every line is backed by some 근거 item;
- a list / setting question states the management location and how to change it;
- the effect timing of periodic processing is not asserted;
- key 근거 actually read in code carry a code location + 요지 (≤ 3), and no long code is pasted;
- each 근거 with a "문서:" line really has that fact in that document's body;
- no allowed value, constant, or threshold is 확정 from a document alone;
- where documents and code differ, the code is followed and the differing
  document is not cited;
- 확인할 수 없는 부분 does not cover the whole question (unless nothing could be confirmed and 결론 says so, with why).

You run this list yourself before sending, on every path — no extra audit round.

## Writing rules

- Only the four parts, in this order; impact questions add 바꾸면 같이 봐야
  하는 곳 directly below 쉽게 말하면 (impact.md). No other section.
- The final message starts with `### Q.` — no preface, no narration of the
  work, no English. Visible body ≤ ~1,500 Korean characters; impact ≤ ~3,000.
- Shortening never merges facts of different features or generalizes a
  condition beyond the feature whose code was read. Each fact appears once.
- The answer states results only. How they were found — collectors, tool
  calls, sweeps, expansion, models, 수집기 품질 — goes in the session ledger
  `notes`, never in the answer.
- `[c: id]` markers live only in the draft the auditor reads; the final
  answer strips them (rule 2).
- One shape for every audience. A developer question may name the code form
  it asked about in 결론; 쉽게 말하면 never (SKILL.md rule ⑥).
- Boundary wording (from the ledger): "확인한 범위에서는 …" with the unread side
  or callee as a 확인할 수 없는 부분 item; a date guard as "<종료일 | 시작일 |
  대상 기간 | 가입일 조건> <가드 날짜> 기준, 오늘 <today> → 종료됨 | 진행 중 |
  해당 대상에만 적용"; a flag as "설정값에 따라 달라짐" with the flag name only in
  근거 and its live value under 확인할 수 없는 부분; "(서버 응답 문구)" / "서버에서
  거부" when the screen code was not read.
- Every ask gets a 결론 / 쉽게 말하면 line or a 확인할 수 없는 부분 item.
- Several questions: one block per question; shared 근거 in the first block,
  later blocks say "근거: Q<m> 참고" (the auditor then receives Q<m>'s 근거
  items as this block's).
