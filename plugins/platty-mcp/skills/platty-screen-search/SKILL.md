---
name: platty-screen-search
description: "Main entry for every Platty project question asked through Platty MCP: start here, before platty-mcp-search. Use when a business user (현업) asks how to get something done or why something happens — a screen, menu, label, button, field, list item or message, \"왜 안 되지 / 왜 이렇게 나오지 / 어떻게 하지 / 어디서 바꾸나요\" — even when no screen is named. Finds the term in the term registry, has the user confirm the menu/screen, reads the code, asks which situation applies when the symptom has several causes, and answers only for that situation in short screen words, with the code evidence in a separate attachment for reviewers. A question that is not about using a screen (a business rule across features, change impact, a developer, batch or interface question) is handed to platty-mcp-search in the routing step."
---

# Platty Screen Search (현업 화면 질문)

DRAFT 2026-10-22 rev6 + 2026-10-26 opus-advisor edits E1–E24 + 2026-10-27 v1 (E25–E31: fan-out writer paths, recursive caller climb, column-carry filter, target rows, no call budget) + v2 (E32–E37: W6b action order and save checks per situation, 자동 반영, guard rows by tested column, permission = 6c only) + v3 (E38–E41: combo item names, list-filter guard, non-interactive length, 6c wording) — PoC entry skill of the platty-mcp plugin.

A business user asks in the words printed on their screen. The same word means
different things in different menus (`MD` in 상품 vs 매장), so the answer must
be anchored on the screen the user actually means **before** any document or
code is read. Start from the screen, find its EPIC, read the business documents,
then the code. What the user can do next depends on the situation they are in,
so when the code shows several possible causes, **ask which situation applies
and answer only for that one**.

The answer has **two layers**. The user reads layer 1: a short answer in the
words of the screens, like a FAQ entry (what is the cause, what to click, what
to do if it still fails). Layer 2 is an attachment for reviewers: the table of
facts and code evidence behind layer 1. All the care about what was read, what
was not, and how sure we are lives in layer 2, not in the user's sentences.

## Routing — first step of every question

Every Platty project question starts in this skill. Decide once per question,
before any tool call:

- **Stay here** when the question is about doing something on a screen or
  about what a screen shows: a label, button, field, menu, list item, error
  message, "어떻게 / 어디서 / 왜 안 돼 / 왜 이렇게 나와", a value the user wants
  to change or register. A missing screen name is not a reason to leave:
  step 2 finds the candidate screens.
- **Hand off to `platty-mcp-search`** (load it and follow its checklist; do not
  run this one) when the question is not about using a screen: a business
  rule or policy across features ("반품 클레임은 어떤 규칙으로 처리돼?"),
  change impact or regression ("바꾸면 어디가 영향받아?"), a developer question
  that names code (class, API path, table), a batch, interface or 연동
  question, or a question list over a whole EPIC.
- Unsure → stay here; the screen confirmation (step 3) settles it, and its
  "목록에 없음" with no screen found hands the question to `platty-mcp-search`.
- A question list: route each question on its own.
- Do not tell the user about the routing.

## Ground rules

- Only configured Platty MCP tools; read-only. Same rules as
  `platty-mcp-search` Ground rules (no host shell, no local files, tool names
  from `tools/list`, facts are 분석된 소스 기준).
- Apply `platty-mcp-search` Core rules ①–⑩ to every sentence (state only what
  was read, both sides for absence, screen text only from screen code, …).
- Calls that do not depend on each other may be sent together; a call whose
  arguments come from an earlier result is made only after reading that result.
- The confirmed screen is the scope. Never widen to another screen or EPIC
  without saying so in layer 2 (확인하지 못한 부분).
- Use the `projectId` that `context_status` returns in every later call.
- A tool result that is too large is saved to a local file by the host. Never
  open that file (no local files). Re-call with a smaller `limit` or a
  different tool; do not retry the same call.

### Tool forms that work

- `readonly_workspace_shell` takes `repoId` (from the evidence / entryPoint)
  and accepts only `grep -n '<word>' <file> [<file>…]` (also `grep -n -i`) and
  `sed -n '<a>,<b>p' <file>`. One `grep -n` over several files of one repository is
  the cheap way to find a column in a list of files. Patterns must be plain words: no `<`, `>`, `|`,
  `"`, `&`, `;`, `$`, backslash or backtick (they are rejected as control
  characters). `grep -r`, `-c`, `-A`, `-B`, `--include` and path-style
  arguments are rejected too (so are `\|` alternations in some builds: split them
  into one `grep -n` per word). To see a comparison operator, read the line with `sed -n`.
- `term_lookup`: always pass `text`, and `limit` ≤ 10. Never call it with
  `entryPointId` alone (the result is ~80 KB and is saved to a file). With a
  confirmed screen use `text` + `entryPointId`.
- `route_relations` on an API: pass `kinds` (for example `["db_access"]`) and
  `limit` ≤ 15, then page with `cursor`. Without them the result can exceed
  50 KB.
- `workspace_search`: `fixedStrings: true` (except the step-5b writer patterns: regex, no `repoIds`, so every repository is searched), `limit` ≤ 30, `globs:
  ["**/src/main/**", "!**/src/test/**"]`, and `repoIds` of **all** backend
  repositories of the project (the screen repository times out; read screen
  files with `grep -n` / `sed -n` on the known file instead). **One spelling
  per call.** A column is written three ways: `COL_NAME` (SQL), `colName`
  (field/binding), `ColName` (Java getter/setter). SQL-spelling searches are
  dominated by read queries, so start with the Java spelling, or with the
  statement id when you already see an update statement. Its hits are
  candidates: open every hit you rely on with `sed -n`. `repositoriesSearched`
  and the repository list tell you which repositories exist in this project.
  Regex is the `rg` dialect, one line at a time: lookaround (`(?!…)`) is rejected as
  invalid; nothing matches across lines (`\s` stops at the line end; a `\n` makes every
  repository report `status: error` with `matchCount: 0` — a failed search, not zero
  hits); `\b` never matches after `$`, so end a table name with `([^A-Za-z0-9_$]|$)`;
  `ignoreCase: true` works.
- EPIC: `spec_search(query: <API last URL segment>, specKind: "api_spec",
  limit: 3)`. Every hit carries `epicId` / `epicName`; use the hit whose
  `documentTitle` is the API. `spec_get` on a screen spec always fails
  (hundreds of thousands of characters) and on an API spec can exceed 50 KB:
  do not use it for the EPIC.
- Screen file → menu: `menu_lookup(text: "<screen file path, e.g. MT/OG/UI_MTOG_01001.xfdl>")`
  returns the linked menu with `match: key`. Never guess menu words from the
  question or from table comments.
- `route_impact_candidates(tables)` lists at most 50 routes per table, mostly
  readers, and its cap is not recoverable: never use it to find or rule out a
  writer.

### Wording rules

- Analysis-tool markers on a route or screen (`deprecated`, `reduced scope`,
  `sweepStatus`, `gapCodes`, `needs_review`) describe the analysis, not the
  business. Never put them in layer 1. If one matters, say "분석 도구의 표시일
  뿐 화면이 쓰이는지와는 별개" in layer 2.
- **Code values.** The meaning of a code value (what `A60`, `'000'`, `'3'`
  stand for) counts only when one of these says so: a term card or
  dictionary row, a glossary entry, a common-code row, an enum or constant
  definition that pairs the value with a name (`("3","…")`, `DIRECT = "0"`), or
  the display-name line of the screen's own combo/radio. A SQL/code comment does
  not prove it. Without such a source write the neutral wording ("해당 직책구분
  값", "특정 값") and put "코드값의 뜻은 확인하지 못함" in layer 2. **Never
  state in either layer that a code value means a person or role** unless one
  of those sources says so.
- **Words the user will recognise (role and item names).** This is different from
  code values. A role or item name that appears in text the system itself shows
  — a screen label, a menu or screen title, a string literal of an alert or
  message — may be used as written, and quoted from that line. Example: an
  exception argument "마진 확정자(팀장) 정보" lets you write "확정자(팀장)".
  Do not turn it into a claim about a code value or about who in the company
  holds the role.
- **Word bridge.** The user's screen, the screen where the action is taken and
  the error message often name the same thing with different words (one screen
  says "확정자", another "팀장"). When the answer uses a word that is not on the
  screen the user confirmed, add one bridge line in layer 1 stating where each
  word appears ("마진등록신청 화면에는 '확정자', 오류 문구와 마진등록 확정(팀장)
  화면에는 '(팀장)'으로 나옵니다."). Evidence for "same thing": both words in one
  message literal, one title, a glossary entry you read, or a W7 data-flow trace
  (step 5b). Without such
  evidence do not say they are the same; write "같은 대상인지는 확인하지
  못함" in layer 2 and use the user's word in layer 1.
- **Action screens speak their own words.** When an action is to be done on
  another screen, read that screen's item, column and button names
  (`term_lookup(text, entryPointId)` or `sed -n` on its label lines) and write
  the steps with those names, not with the user's screen's words or code names.
- **Quotes.** A label in quotes must be copied from a `text=` / `tooltiptext=` /
  title line you read; otherwise describe the item without quotes. A message
  text in quotes must be the string literal passed to the alert call or a row of
  a message table you read (`appvariables.xml`: `grep -n 'CMxxxx'`). A `//`
  comment next to the call is not the message: use only the message ID and its
  arguments in layer 2.
- **Comparisons.** Write the operator as words with the boundary: `<` 미만
  (그날은 제외), `<=` 이하 (그날 포함), `>` 초과, `>=` 이상. Never write 이전/이후
  alone. When the wording shown to the user differs from the real condition (a
  message says "금일 이후" but the code rejects today and accepts tomorrow),
  state both. Do not state units (글자/바이트) unless the validator's definition
  was read.
- **Absence.** In layer 2: "찾지 못함" means you searched and name the search
  (tool, word) and that it found nothing. "검색하지 못함" means you did not
  search. "없다" is allowed only for what you read whole. Zero menu hits never
  mean the screen does not exist: write "<검색어>로는 찾지 못함". In layer 1 an
  unknown is a short plain sentence ("이 화면에서는 방법을 찾지 못했습니다"); no
  search vocabulary.
- A claim with 항상/모두/전혀/없다/뿐 names what was read; if a function, file or
  query the decision depends on was not read to its end, do not use these words.
- **Layer 1 never contains** code names, table or column names, API paths,
  message IDs, file paths, budget or call counts, rule wording of this skill, or
  words about the analysis (deprecated, 후보 구현). It does not mention other
  situations than the chosen one (non-interactive: only the step-6 situations, each in
  its own block), and it does not say what is *not* a cause.
- **Layer 1 states only rows.** Every step and closing line restates one 5b row
  (or a 6a/6c fact read in step 5) in the form of its status:
  메뉴 확인 → "「<menu path>」에서 <item/button names>: <what to do>."
  화면만 → the same with the screen title, plus "메뉴 위치는 찾지 못했습니다."
  배치 / 소스 밖 / API만 → two sentences. (1) What is missing: the deciding
    statement's conditions restated only with words read on a screen, a menu or the
    message (a condition on a code value or on a column without such a word stays in
    layer 2): "<missing thing>이(가) 없으면 같은 문구가 뜹니다. 이것은 이 시스템
    화면에서 바꾸는 곳을 찾지 못했습니다." When the symptom has no message (a locked
    field, a missing list item), drop the first clause: "<thing in screen words>은(는)
    <how it is set, in screen words>로 정해지며, 이 시스템 화면에서 바꾸는 곳을
    찾지 못했습니다." (2) "담당 부서에 다음을 알려 주세요:
    <facts>." Facts = values the user sees on a screen named in layer 1 (named by that
    screen's label) or knows (their 점포·팀, their own ID), and the message as shown;
    never a table, column or code value.
  미완 → only "<data in screen words>을(를) 어디서 바꾸는지는 아직 확인하지
    않았습니다. 이어서 확인해 볼까요?"
  Steps inside a 메뉴 확인 row (search, pick a row, save) belong to that row; each names
  an item by a label read on that screen. An item with no label (a check column
  without header) is described without quotes by what was read about it; an action
  whose button label was not read is described ("저장합니다") only if its function
  was read. Any other sentence is deleted.
  "담당 부서" appears once in layer 1; "안 풀리면" is omitted when it would repeat it.
  No other hedge ("~일 수 있습니다", "(확인 필요)") exists in layer 1.

## Checklist

1. **Setup** — `context_status`; remember its `projectId`. If
   `documentAvailability` is empty, or `term_lookup` and `menu_lookup` are both
   `missing`, the project has no analyzed documents or menus: stop and tell the
   user so ("이 프로젝트에는 분석된 문서/메뉴가 없어 답변할 수 없습니다"). Do not
   guess from code. If only one of them is `missing`, say which data is not
   imported and continue with what exists (step 2 fallbacks).
2. **Find the term → candidate screens**
   - Pick the screen words of the question (labels, buttons, field names,
     menu names). One `term_lookup(text, limit: 5)` per word, at most 3 words.
     Words of 3 letters or fewer, or very common ones (`MD`, `매장`, `점포`,
     `코드`), match hundreds of cards.
   - A result with `hasNextPage: true` or `truncated: true` is a **partial**
     candidate list. Do not treat it as complete: also run `menu_lookup(text)`
     with the same word, then ask the user for one more word from the screen
     if the candidates are still unclear.
   - **Candidates = the union** of the `screens[]` of every card you read and the
     linked screens of every `menu_lookup` hit. Do not drop a candidate because
     only one tool found it. A menu that is inactive and has no linked screen is
     left out; note it in the log, not to the user.
   - From every card take `screens[]` (`screenEntryPointId`, `menuPaths`).
     A card with `match: fuzzy` is a guess: show its display name in the
     confirmation question ("혹시 '상품코드' 말씀이세요?").
   - The question names a menu or screen → `menu_lookup(text)` first; its
     linked `screen.entryPointId` are the candidates.
   - No card and no menu (`total: 0`, or `availability: not_imported`) →
     `menu_lookup(text)` with the same word, then `glossary_translate(text)`;
     still nothing → ask the user which menu they were on (step 3 with
     `menu_lookup` roots as options). Words that only appear in an error
     message are not screen labels: cards are often empty for them, so go by
     the menu path in the question or `menu_lookup`. Then find the throw:
     `workspace_search(<one distinctive piece of the message, e.g. a word with
     brackets>, fixedStrings: true, limit: 30, globs: ["**/*.java", "**/appvariables.xml"])`
     — the message is a template plus an argument and the user's spacing differs, so
     never search the whole sentence. Keep the hit whose template (`grep -n '<message ID>'`
     on `appvariables.xml`) plus argument gives the user's wording; its service →
     `route_resolve` → API, and check that the confirmed screen calls that API URL.
3. **Confirm the screen — always, even with one candidate**
   - One question (`AskUserQuestion` / `request_user_input` / plain question
     and stop). Options = the candidates' menu paths `A > B > C`, **2–4 menus
     plus "목록에 없음"**. More than 4 candidates → ask which first-level menu
     (options = those groups, ≤ 4, plus "목록에 없음") and then ask the screens
     inside the chosen group (`menu_lookup` with `parentMenuId` lists the next
     level). Never cut the list to 4 yourself. Nothing else in the question: no
     explanation of what the screen does, no hint about the cause.
   - A candidate without a menu path: label it with the screen spec title
     (`route_relations(entryPointId)` → `specDocumentIds` → `spec_list` /
     `spec_search` title).
   - Non-interactive run (`-p`, `exec`, question list): do not ask; answer the
     top ≤ 3 candidates separately, each block headed by its menu path.
   - "목록에 없음" → `menu_lookup` browse from the roots with the user; still no
     screen → hand the question to `platty-mcp-search` (Routing).
4. **Screen → EPIC → business documents** (confirmed `screenEntryPointId`)
   - `term_lookup(text, entryPointId, limit ≤ 10)` — only this screen's paths
     for the word: the API ids (`apiEntryPointId`), roles (`button_label`,
     `search_condition_label`, `sql_param`, …) and source locations.
   - `route_relations(screen)` → `specDocumentIds` (screen spec) and the
     screen's `api_call` / `navigation` relations. The list can miss an API
     the screen calls (typically the save call): read the service URL in the
     screen source, then `route_resolve(query: <last URL segment>)` gives its
     `entryPointId` and `specDocumentIds`.
   - EPIC: `spec_search` as in "Tool forms". `epic_get(epicId, view: summary)` —
     one paragraph of context, never the answer by itself. No `epicId`, or
     `epic_get` unavailable → skip it and say so in layer 2.
   - `spec_business_resolve(specDocumentIds = screen spec + the APIs' specs)` →
     the business rules / use cases this screen grounds → open the items that
     match the question with `business_rule_item_get` / `use_case_item_get`.
     `hasNextPage: true` means items were not read: say so in layer 2.
5. **Down to the code — mandatory**
   - For each API on the word's paths: `route_relations(api, kinds, limit)` →
     DB access (table, read/write), events, external calls, `entryPoint.auth`,
     with evidence lines.
   - Read the actual lines: `readonly_workspace_shell` `sed -n` around each
     evidence line and each `term_lookup` location (the label line in the
     screen file, the `sql_param` / `sql_result` line in the mapper).
     `route_code(api)` when the deciding branch is not on those lines.
   - **Read both sides.** For "안 돼요 / 막혀요 / 오류" questions read the screen
     condition (read-only switches, validators, `gfnAlert` calls) **and** the
     server service/SQL, and say which side blocks (layer 2). Search the screen
     file for the menu's save-permission switch (`savBtnUsgYn`, `SaveAuth`,
     `set_readonly`) when the symptom is "can't edit / can't save". When the
     symptom is about a combo or list, read the code that fills it, including
     its filter.
   - **Read what the condition calls.** A common function in the deciding
     condition (`gfn*`, `mtfn*`) → read its definition once (also search
     `nexacrolib/` when the project has it), or list it as unread. A value
     compared with what a popup returned → read the popup's server query to its
     end (its service URL is in the popup source).
   - **Role words** in the question (SM, 바이어, 팀장): look in the code for the
     field that tells the roles apart (session user type, mapping table). If
     there is none, write "코드에는 이 역할 구분이 없음" in layer 2.
   - **Radio/combo items**: read their item names and values (the `text` /
     `dtlCdNm` lines), not only the code that switches them.
   - Write down, as you read, every **deciding condition**: a value or row that
     must exist, a read-only or permission switch, an input rule (date limit,
     required field), an error-message condition, a mismatch between two
     values, and any **order of processing** that decides what has to be done
     first. Step 6 needs this list. Also note which words the screens and
     messages use for the same thing (for the word bridge).
   - The answer may only say what these reads showed (Core rule ①).
   - Batch jobs involved (the table is written by a job) →
     `route_impact_candidates(entryPointIds: [api])` → `job_dependency_trace`
     for the writer job. If the code that applies the change (a batch, a
     scheduler, another repository) is not among the repositories that
     `workspace_search` reports, say that in layer 2, name the repositories
     searched, and do not guess. In layer 1 say only that this part could not be
     checked in the analyzed source.
5b. **Writer trace — mandatory, for every deciding data row, before step 6.**
   The fix for missing or wrong data is usually on a screen whose name shares
   no word with the question. Trace it from the data, never from the user's words.
   - **Rows.** Two kinds, both mandatory:
     - **Guard rows.** Open the statement whose result the deciding guard tests (the
       query before the `throw` / alert, or the value a read-only switch reads).
       One row per table whose column the guard actually tests (the column in the
       `if`, the WHERE condition that empties the result, or the selected column the
       switch reads) — not every joined table. When the symptom is "the item I want
       is not in the list", the WHERE filter of the query that fills that list is a
       guard too (for example a use-flag column). A code
       literal is not a row: it adds its column to that table row's deciding columns
       (W2); a literal of a common-code table belongs to that table's row.
       A menu/button permission switch (`savBtnUsgYn`, `gdsMenu`, session authority) is
       not a 5b row: it is handled by 6c only.
     - **Target rows.** When the user wants to change, register or fix a value ("~을
       바꾸고 싶어요", "~이 변경되지 않아요", "~은 어디서 등록하나요"), the table.column
       bound to that label on the confirmed screen (the term card's `addresses`, or the
       save statement's SET line for that binding) is a row of its own, even when no
       guard reads it. The fix is wherever **any** code writes that column.
     No row cap: trace every guard row and every target row.
   - **Per row, fan out — never stop at the first status.** A table is often written
     by several statements, and one statement is often reached through several
     callers; the screen the user needs may sit on any of these paths, under a name
     that shares no word with the question. Each W1/W1b writer statement that passes
     W2 is a **path**; trace every path through W3–W6 and give each path its own
     status. A row is done only when every path has a status.
     W1 `workspace_search(pattern: "(INTO|UPDATE|DELETE\s+FROM|INSERT_INTO|DELETE_FROM)[\s(\x22\x60]+<TABLE>([^A-Za-z0-9_$]|$)",
        ignoreCase: true, fixedStrings: false, limit: 200, globs as usual)`; write `$` in the
        table name as `\$`; never end with `\b`.
     **Truncated results.** Any W-step search with `truncated: true` (overall or one
        repository) is re-run with a larger `limit` (up to 1000) or split by `repoIds` /
        `globs` until no repository is truncated. "열어 보지 않음 / 나머지 생략" is not
        allowed for writer statements or callers.
     W1b split statements (keyword alone on the line above the table):
        `workspace_search("^\s*<TABLE>\s*(\(|/\*.*\*/)?\s*\(?\s*$", ignoreCase: true, limit: 100,
        globs: ["**/*.xml", "!**/src/test/**"])`, then
        `workspace_search("^\s*(UPDATE|INSERT\s+INTO|INTO|DELETE|DELETE\s+FROM|MERGE\s+INTO)\s*$",
        ignoreCase: true, limit: 100, globs: ["**/<file name>" of each W1b file, ≤ 20])`.
        A keyword line directly above a W1b line is a writer hit like W1's.
        No writer from W1 + W1b, all `truncated: false`, every repository `complete`
        → **소스 밖**. W1b truncated or over 20 files and no W1 writer → **미완**.
        Writers only in a batch repository → **배치**.
     W2 Column filter — this, not word similarity, decides relevance. Few hits: `sed -n`
        ~20 lines around each hit → statement id, and whether it writes the row's
        deciding/target column (INSERT/DELETE count; an UPDATE without such a column in
        SET is dropped; a column inside `<if>` counts, note the condition).
        Many hits: per repository one `grep -n '<COLUMN>' <its W1/W1b files>` per
        column; keep an UPDATE hit only when a `<COLUMN> =` line (any
        value: `#{…}`, literal, function) lies after its SET and before the statement
        end, confirmed by one `sed -n <hit>,<line>p`. Nothing left → **소스 밖** (열 기준).
     W3 Caller climb, recursive and fanned out.
        (a) `workspace_search("<namespace>\.<statement id>\x22", globs: ["**/*.java"])`
        (namespace from the mapper's `namespace=` line; one id exists in many mappers) →
        repository method.
        (b) `workspace_search(".<method>(", fixedStrings: true, globs: ["**/*.java"])` →
        open **every** caller with `sed -n` (method name, the guard before the call, and
        the lines that fill the argument object). A line in a comment (`//`, `*`) is not a
        caller.
        (c) **Column carry check** per caller: keep it only if it sets the row's column on
        the object it passes (`set<Column>(`, a builder, a map `put("<column>"`, or passes
        a DTO received from the request unchanged). A caller that sets only other fields
        (an id, a flag) is dropped with that reason in layer 2.
        (d) If a kept caller is itself a shared/API service method (not a controller
        handler, a batch tasklet/step, a listener or an external-API controller), repeat
        (b)–(d) with **its** method name. Wrappers such as `…APIService.modify…`
        routinely have many business callers one level up; each is its own path.
        Stop a branch only at a controller handler, a batch, a listener, an
        external-API controller, or no caller (drop with reason).
     W4 `route_resolve(query: <controller method or URL segment>)`; no API →
        `workspace_search("<method>(", globs: ["**/controller/**"])`, then `route_resolve`
        on the controller method. A batch class → **배치**. An API whose controller says it
        is called from outside (comment, `/gyr/`, `/ext/`-style mapping) and no screen calls
        it (W5) → **API만**.
     W5 `workspace_search(<API last URL segment>, fixedStrings: true,
        repoIds: [<screen repository>], globs: ["**/*.xfdl", "!design/**"])`. No hit → **API만**.
        A hit in a popup/sub-form (opened with `gfnOpenPopup` / not a menu screen):
        `workspace_search("<popup file name>", fixedStrings: true, repoIds: [<screen
        repository>], globs: ["**/*.xfdl", "!design/**"])` → the opener screen and the
        button/function that opens it; continue W6 on the opener; layer 1 names the popup
        by its `titletext` and the opener by its menu or title.
     W6 `menu_lookup(text: "<screen file path>")`: `match: key` → **메뉴 확인**;
        none → also try `menu_lookup(text: "<titletext>")`; still none → **화면만**
        (name = the screen's `titletext` line).
     W6b **How the user gets it done on the writer screen** — mandatory for every
        메뉴 확인/화면만 path; read each item to its end:
        (1) the column's component on that screen (the BindItem for the column) and its
            initial `readonly=` / `enable=` attribute. No component bound to the column →
            the screen does not let the user enter it: the path is **자동 반영** (layer 2,
            and at most one 안 풀리면 phrase), never a layer-1 step;
        (2) every function that toggles that component (`set_readonly` / `set_enable` on
            its id, and shared lock functions that include it), and for each toggle **the
            user action that runs it** — follow the caller up to the event handler
            (`onitemchanged`, `onclick`, `onrowposchanged`, form load) and read the branch
            condition (for example: the component opens only after another combo is
            changed to a value different from the loaded one). When the branch depends on
            a combo/radio value, read that control's item names: its `innerdataset` rows,
            or for a common-code combo the code group it loads (`cmmnCd:"<GROUP>"`) →
            `term_lookup(text: "<GROUP>")` / `glossary_translate` / `workspace_search` of
            the group's rows; name the item in layer 1 by that display name. Display name
            not readable → write the action as "지금과 다른 값으로 바꿉니다" plus the alert
            literal that names the allowed case, and put "콤보 표시명 확인하지 못함" in layer 2;
        (3) the save validation of that screen (its `cfnSave` / `fnSave…Validation` to the
            end): every check that involves the column, the fields the screen clears when
            the column changes, and values of the **user's situation** (the guard value on
            the user's screen, e.g. a filled 공간ID) — quote each alert literal;
        (4) the server branch on the path that decides whether the column is applied now
            or later (date or flag conditions read in W3).
        Layer-1 steps for this path = the order of user actions from (2), the inputs and
        save-time conditions from (3) that apply to the user's situation, and the timing
        from (4). If (3) rejects the save for the user's situation, say so: that path is
        not a way out for this user.
   - Statuses are closed: 메뉴 확인 / 화면만 / API만 / 배치 / 소스 밖 / 미완
     (a tool failed or timed out twice on the same call; not for "too many calls").
     Every **path** gets one, with its call results, in the writer table of layer 2
     (one table line per path; a row may have many lines).
   - Before step 6, list the paths whose status is 메뉴 확인 or 화면만 for each target
     row. Zero such paths for a target row while W3 dropped callers or any search was
     truncated → go back; the trace is not finished. "쓰는 곳 없음" exists only as 소스 밖 on W1 evidence
     (pattern, matchCount 0, truncated false, repositories searched =
     `workspace_repo_list` count, "한 줄 형식 기준").
   - For a 메뉴 확인 row read the screen's item and button names (Action screens
     speak their own words).
   - **W7 word bridge** — only when layer 1 uses a word from the message next to a
     different word of another screen. Follow the value the guarded query returns:
     (a) `grep -n '<returned field>' <service file>` → the setter that puts it in the
     saved data; (b) `grep -n '<COLUMN>' <mapper>` + `sed -n` → the INSERT/UPDATE that
     stores `#{data.<field>}` (table, statement id); (c) `workspace_search("<TABLE>([^A-Za-z0-9_$]|$)",
     globs: ["**/*.xml"])` → per repository `grep -n '<COLUMN>' <those files>` → a WHERE
     line `<COLUMN> = #{…}` and its select id (one reader is enough; truncation does not
     matter); (d) W3–W6 on that select → screen and menu; (e) `grep -n -i '<field>'
     <user's screen file>` → the header that shows the value. ≤ 8 calls. Bridged when
     (b) and (c) are the same table and column. Layer 1, one **용어** line: "<message
     word>는 <user's action> 때 정해져 저장되고, 「<menu of (d)>」은(는) 그 <message
     word> 기준으로 목록을 보여 줍니다. 「<user's screen>」의 '<header of (e)>' 칸이
     그 값입니다." Write "본인/로그인한 사람" only if the binding of the compared
     parameter to the session user was read.
6. **Which situation is the user in? — ask when the symptom has several causes**
   The right action depends on the user's situation, and the user knows it
   better than the code does. Do not list every possible action.
   - **Derive the situations.** From the deciding conditions of step 5 and the rows of the 5b writer table, keep those
     that can produce **this** user's symptom. A situation is defined by **the
     action it needs**: causes that need the same action (or that the user cannot
     tell apart on screen) are **one** situation; causes that need a different
     action — or the same condition reached by a different order of steps —
     are different situations. One short sentence in screen words that the user
     can check on their own screen. Do not invent, do not include a cause the
     question already rules out, do not put an unread guess in as an option. Do
     not rank ("가장 먼저 의심되는"). Writer paths with the same screen are one situation; all 배치 / 소스 밖 / API만 paths together are one situation that ends at 담당 부서.
     A target row with a 메뉴 확인/화면만 path that has an editable component (W6b 1)
     is never dropped: that screen is where the value can be changed, and it appears
     in layer 1 with its W6b action order and save conditions, even when a guard on
     the user's screen explains the lock. Each such screen is evaluated **for each
     situation**: a screen whose save check (W6b 3) rejects the situation's guard value
     is written for that situation as "이 경우에는 이 화면에서도 저장되지 않습니다" plus
     the alert, not as a way out.
   - **Zero or one situation, or an explanation / capability question** ("~는 어떻게
     세팅되나요", "~할 수 있나요" with a single path) → do not ask. Go to step 7 and
     answer directly (6a below still applies).
   - **Two or more situations → ask one question and stop** (same tool as step
     3). Before the question write at most two lines: the condition the screen
     checks, in screen words (not a repetition of the message). No walk-through
     of the code logic and no actions yet. The question is "지금 어느 경우에
     가까우신가요?" with
     - ≤ 4 situations, the most directly tied to the symptom first,
     - under each one a line "확인: <where on the screen to look>" that a user
       can really do: the menu path of a 5b 메뉴 확인 row (or the user's own screen) and the item or column name read on that screen. If you cannot
       find the screen, write "확인할 화면을 찾지 못함" instead of describing
       a table or a data state the user cannot see,
     - plus "잘 모르겠어요" and "다른 경우".
   - Non-interactive run: do not ask; use the non-interactive answer form (Output
     format), each situation (≤ 4) a block of ≤ 4 lines, using 6b. The 배치 / 소스 밖 /
     API만 situation is not a block: it is the 안 풀리면 line.
   - **After the user answers:**
     - a situation → run 6b for that situation only, and answer that branch only
       (step 7).
     - "잘 모르겠어요" → give for each situation only its "확인" line, say to
       come back with what they see, and stop. Do not guess.
     - "다른 경우" → ask in one free-text question what they see on the screen,
       then go on with that description: if it matches no situation you read,
       say in layer 1 that the cause could not be determined from the analyzed
       source, give the "확인" lines of the situations you do know, and stop.
   - **6a. Same screen.** If the screen code lets the user change a value, a date
     or a selection that releases the condition, say exactly what to enter or
     choose. Reading the entry procedure counts: the order of steps, the first
     guard of the add-row button, the required fields. If the order of steps
     decides what works (delete first, save, then add), say the order and give
     the reason in half a sentence.
   - **6b. Another screen** — take the 5b path(s) of the chosen situation; no
     new search unless a path is 미완 (then continue W1–W6b for that path only).
     Layer-2 label **확인됨** = 메뉴 확인 with the W2 statement, the W3 guard and
     the W5 call line read; any other status is written as that status.
   - **6c. Permission or setting** that the code reads (for example a menu's
     save-button switch): say which condition blocks and that the setting has to
     be checked ("이 메뉴의 저장 권한 설정을 확인해야 합니다"); do not name who can
     change it unless a source says so, and do not use "담당 부서" in that sentence
     (it stays reserved for the single 안 풀리면 line).
   - **6d. Operating procedure not in the source** (who approves, who to ask,
     deputy/temporary-approver rules, request forms): do not write it. In layer 1
     the last line says "담당 부서에 확인이 필요합니다" only; in layer 2 "운영
     절차는 분석된 소스에 없음".
   - Never promise an outcome. "~를 확인/바꾸면 이 조건은 풀립니다" only when the
     condition → effect was read. If no action could be derived after 6b, layer 1
     says "이 화면에서는 방법을 찾지 못했습니다" and layer 2 names what was
     searched.
   - 6b costs no call when its 5b rows are complete. Deriving the situations costs no call.
7. **Answer** — layer 1 and layer 2 as below, for the situation the user chose (or
   the only situation). Before sending, do the self-check without tools:
   (a) every layer-1 sentence is a row of the layer-2 table; (b) a sentence whose
   key fact appears in 확인하지 못한 부분 is rewritten or deleted; (c) every quoted
   label or message appears verbatim in something you read; (d) every 확인됨 has
   the effect read; (e) the first line answers the question (yes / no / partly,
   with scope); (f) layer 1 has none of the items under "Layer 1 never contains"
   and uses the words of the screen where the action is done; (g) every number
   you state (how many places, lines) was counted from a list you can show;
   (h) the writer table has one line per writer path of every guard row and
   target row, each with a status and its W-call results, every dropped caller with
   its reason, and no truncated search left; (i) every row of
   the chosen situation appears in layer 1 in its status form; (j) "담당 부서"
   appears once and every fact handed over is a value on a screen named in layer 1
   or known to the user; (k) a message word set next to another screen's word has a
   W7 trace or another Word-bridge evidence line.

## Output format

Situation question (step 6, when asked):

```markdown
### Q. <질문>  (메뉴: <확정한 메뉴 경로>)
<화면이 확인하는 조건을 화면 말로 1~2줄>

**지금 어느 경우에 가까우신가요?**
1. <상황, 화면 말로 한 문장> — 확인: <메뉴 경로 > 화면의 항목/열 이름>
2. …
3. 잘 모르겠어요
4. 다른 경우
```

Non-interactive answer form: the Answer below without `[상황: …]`; after **한 줄 답**
one block `**경우 N. <상황, 화면 말로>**` per situation (≤ 3 lines each, in place of
**이렇게 해 보세요**); **안 풀리면** at most once; one layer 2 for all rows.

Answer:

```markdown
### Q. <질문>  (메뉴: <확정한 메뉴 경로>)  [상황: <사용자가 고른 상황>]

**한 줄 답**: <원인 또는 결론 한 문장. 예/아니오/부분. 화면 말로.>

**이렇게 해 보세요**
1. <메뉴 경로 > 항목/버튼 이름: 무엇을 한다> (그 이유 반 문장, 필요할 때만)
2. …
3. …  (최대 4개. 작성 주체 표의 행을 상태별 문장으로. 미완은 재질문 한 줄)

**안 풀리면**: <한 줄: 무엇을 보고 어디에 알려야 하는지. 소스에 있는 것만. 없으면 "담당 부서에 확인이 필요합니다.">
**용어**: <필요할 때만 한 줄: 화면마다 다른 단어 연결>

(코드 기준 답변입니다. 운영 절차는 별도 확인이 필요합니다.)

---
**검수용 첨부 (코드 근거)**

| 조치 / 주장 | 라벨 | 근거 `경로:줄` |
|---|---|---|
| … | 확인됨 / 후보 / 확정 / 추론 | … |

**작성 주체 표 (5b)**
| 판정 데이터 | W1 패턴·건수·truncated | 쓰는 문장 | 호출 서비스·guard | API | 화면 파일 | 메뉴 | 상태 |
|---|---|---|---|---|---|---|---|

**코드 설명** (최대 5줄)
- 흐름 한 줄: <화면 함수> → <API URL> → <서비스> → <테이블.컬럼>.
- <이 상황에 해당하는 코드가 하는 일을 코드 용어로 짧게>

**확인하지 못한 부분**
- 없음 | 무엇을, 왜, 어디서 확인하면 되는지 (찾지 못함/검색하지 못함 표기, 운영 절차는 분석된 소스에 없음 포함)
```

- Layer 1 target: about 500 Korean characters and at most 4 steps (non-interactive
  form: about 300 characters per situation block); the FAQ
  sentence style (short, imperative, screen and menu names in 「」 or
  as written on the screen). Layer 2 holds everything else. The file paths in
  layer 2 start at the repository-relative path, without the repository id.
- The "한 줄 답" and each step are rows of the table; the table is what a
  reviewer checks.
- Example of the style only (invented screen, not a real one): "**한 줄 답**:
  이 화면의 '단가' 칸은 발주가 확정된 건에서는 수정할 수 없습니다. **이렇게
  해 보세요** 1. 「발주 > 발주조회」에서 해당 건을 열어 상태가 '확정'인지
  봅니다. 2. 확정이면 「발주취소」 버튼으로 취소한 뒤 다시 입력합니다. **안
  풀리면**: 취소 버튼이 보이지 않으면 담당 부서에 확인이 필요합니다."
- Documents and code differ → the code fact only (Core rule ⑦).

## Call budget

No call budget. Completeness beats call count: an answer that misses the screen
where the fix is done is wrong, however few calls it used. Stop a step when its
exit condition is met, not when a number is reached:
- steps 1–3: the screen is confirmed;
- step 4–5: every deciding condition on the word's paths has been read to its end;
- step 5b: every path of every guard and target row has a closed status, no W-step
  search is left truncated, every dropped caller has a reason;
- W7: bridged, or the (a)–(e) chain broke at a named step.
Do not retry an identical rejected call; fix the form (Tool forms) instead. When
5b has many paths, you may hand independent paths to subagents (one path per agent,
with the W-steps, the table.column and the evidence so far); their results are
evidence only after you read the lines they cite.

## Red flags

| Thought | Reality |
| --- | --- |
| "Only one screen matched, no need to ask" | The rule is to always confirm: the user may be on a screen the term was not swept on. |
| "The EPIC summary answers it" | EPIC text is context; the answer comes from the business items and the code lines. |
| "The doc says so, skip the code" | Step 5 is mandatory: Platty documents can be stale. |
| "fuzzy hit looks right" | A fuzzy card is a guess until the user confirms the word. |
| "The user's word is an abbreviation, I know what it means" | Never expand from the letters; use the card's display name / definition. |
| "There are three causes, I will explain all of them and what to do for each" | Ask which situation applies (step 6) and answer only that one. |
| "These two causes need the same fix but differ in a column" | One situation. Split by the action, not by the code condition. |
| "These two have the same condition but the order of steps differs" | Different situations: they need different actions. |
| "I will ask a state question for every question" | Explanation and single-cause questions are answered directly. |
| "The user does not know the state, I will pick the likely one" | Give the 확인 lines and stop; never guess the situation. |
| "No option fits what the user said, I will pick the closest" | Offer "다른 경우" and do not stretch an option over a state it does not describe. |
| "I must explain how the code works so the answer is trustworthy" | Trust lives in the layer-2 table. Layer 1 is what to do. |
| "The sentence needs a caveat in every line" | One closing line in layer 1; the rest in layer 2. |
| "The role is called 팀장 on another screen, so A60 means 팀장" | Role names from screens and messages may be used and bridged; a code value means nothing until a source says so. |
| "The user's screen says 확정자, I will say 확정자 in the action steps" | Use the words of the screen where the action is done, and bridge the two words once. |
| "I know the usual procedure (who approves, who to ask)" | Procedures count only if a source says so; otherwise one closing line. |
| "spec_get failed, retry with a smaller claimLimit" | The size is the screen section, not the claims. Do not call it on screen specs. |
| "The first 5 cards are the candidates" | `hasNextPage: true` means the list is partial; also use `menu_lookup`. |
| "There are 9 candidates, I will show the 4 best" | Show first-level groups and ask in two rounds. |
| "The route says deprecated, so the screen is retired" | It is an analysis marker; never state it as a business fact. |
| "route_impact_candidates shows only readers, so nobody writes the table" | Its cap is unrecoverable. Writers come only from W1/W1b; "none" only as 소스 밖 with the W1 and W1b numbers. |
| "W1 found 0 hits" | Check the pattern first: `\b` after `$` or a `\n` finds nothing by construction (`status: error`). |
| "One path reached API만 / 배치, so the row is done" | A row is done only when **every** writer path has a status. The screen the user needs is often on another path. |
| "The caller search was truncated; I will list the rest as unread" | Re-run with a larger `limit` or split by repository until nothing is truncated. |
| "The caller is `…APIService.modify…`, that is the end" | A shared service is not an entry point. Climb its callers (W3 d) until a controller, batch or listener. |
| "This writer's API name (saveShopChg, 이동퇴점재입점) has nothing to do with '층 변경'" | Relevance is decided by the column (W2, W3 c), not by words. If it sets the column, it is a path. |
| "The term card's write path lists one screen, so that is the only writer" | Card paths come from screen label bindings; code that sets the column through a DTO setter is not in the card. Writers come from W1/W1b + W3. |
| "I traced the guard column; the column the user wants to change is the same table" | Trace the target column too. The guard says why it is locked; the target row says where it can be changed. |
| "I have used many calls already" | There is no budget. Stop only at the exit conditions. |
| "The writer screen's field is editable when 건물 has a value, so the user can change it" | Read who toggles it and on which user action (W6b 2); the field may open only after another value is changed. |
| "I found the screen where the column is saved; that is the answer for every situation" | Read that screen's save checks (W6b 3) against the situation's guard value; it may reject exactly the user's case. |
| "This writer screen saves the column, so it is a step" | Only if the screen has a component bound to the column. Otherwise it is 자동 반영, layer 2. |
| "The read-only switch reads a permission dataset; I will trace its writer tables" | Permission switches are 6c, not 5b rows. |
| "I'll menu_lookup the user's words / the table's Korean name" | Use the screen file path from W5; it is an exact key. |
| "I opened the first caller class, that is enough" | Open every caller class; the one a user action reaches is the one that counts. |
| "Menu search found 0 hits, so the screen does not exist" | Layer 2: "<검색어>로는 찾지 못함". Search the business step words from the caller. |
| "I found the feature but not its menu name, I will name the likely menu" | Never invent or guess a menu name; describe the feature in business words. |
| "The message text is in the comment next to the call" | A comment is not the message; quote the literal or use the message ID in layer 2. |
| "The screen blocks it, so the server must too (or must not)" | Read the server side and say which side blocks (layer 2). |
| "I did not read that function but the result is obvious" | List it as unread and do not use 항상/모두/없다/뿐. |
