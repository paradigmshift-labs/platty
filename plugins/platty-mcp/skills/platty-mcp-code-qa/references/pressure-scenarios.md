# Code QA Pressure Scenarios

Baseline scenarios for `platty-mcp-code-qa`. Each exact prompt is kept
verbatim; do not paraphrase when replaying. RED records the behaviour expected
from the pre-skill route (`using-platty-mcp -> platty-mcp-retrieval` only),
derived from that skill's hard gate and ladder text; replay live against a
code-only project before weakening any rule here.

## docs-zero

**Setup**: `context_status.documentAvailability` has `br`, `ucl`, `design`,
`data_dictionary`, and `glossary` all 0; specs 0; a code search guide is
registered; route tools exposed.

**Exact prompt**

```text
Platty MCP로 답해줘. <메뉴명> 화면에서 저장을 누르면 시스템 안에서 무슨 일이 순서대로 벌어지나요? 개발자가 아닌 사람도 이해하게 써줘.
```

- **RED**: retrieval's hard gate drives project → EPIC → BR/UCL maps that are
  empty, then either stops with "maps cannot be built" or answers from one
  search hit; no plain-Korean template; no file:line trail.
- **Expected GREEN route**: `using-platty-mcp -> platty-mcp-search` (code-only
  mode, in-session on the `platty-mcp-code-qa` ladder); session
  setup (`context_status`, full `code_search_guide_get`, `workspace_repo_list`)
  then L1–L8 via `route_resolve`/`route_relations`, `workspace_search`, and
  shell reads.
- **Observable pass criteria**: answer follows the `platty-mcp-search`
  answer template (결론 → 쉽게 말하면 → 근거 → 확인할 수 없는 부분; the
  code-qa evidence rows feed 근거); every 확인됨 row
  has a shell-read `file:line`; trail lists tools, searches with status; the
  Completion Criteria hold (every claim classified, required steps done,
  fallbacks run).

## partial-specs-only

**Setup**: business families all 0, but `api_spec` and `screen_spec` > 0.

**Exact prompt**

```text
<상태명> 상태에서만 승인이 된다는데 맞나요? 문서는 없고 기술 스펙만 일부 있다고 들었어요.
```

- **RED**: spec counts make the agent treat the project as documented and
  enter the full-cycle ladder; or it quotes a spec summary as the rule without
  reading the service `if` and the SQL `WHERE`.
- **Expected GREEN route**: still `platty-mcp-code-qa` (trigger ignores spec
  counts). A spec may orient the anchor, but T2 collects screen, service, and
  SQL conditions separately from source reads.
- **Observable pass criteria**: three-layer condition list; screen-only checks
  are labelled as not proof of a server rule; code values quoted and meaning
  tagged [DB] unless code labels it.

## search-timeout-truncation

**Setup**: `workspace_search` for a table name returns `truncated: true` and
one repository with `status: timeout`.

**Exact prompt**

```text
<테이블의 업무명> 데이터를 바꾸면 어디까지 영향이 가나요? 빠짐없이 알려줘.
```

- **RED**: the agent lists the returned matches as the full impact, or says
  "그 외 영향 없음" for the timed-out repository.
- **Expected GREEN route**: T6; narrow by repo set and layer globs, retry once;
  remaining partial coverage recorded as "검색 범위 부분적" with repo names.
- **Observable pass criteria**: no absence or "영향 없음" claim for partial
  repos; trail shows each search's status and `truncated`; no identical search
  repeated, and the item concludes after three different searches add nothing
  new.

## outside-system

**Setup**: the business word appears in no registered repository (complete
searches), or the chain ends at an external client / approval callback.

**Exact prompt**

```text
<외부 업무명> 검토가 끝나면 계약 상태가 어떻게 바뀌나요? 담당자 승인 다음 단계까지 설명해줘.
```

- **RED**: the agent narrates the external system's steps from naming or
  general knowledge, or concludes "기능 없음" from one empty search.
- **Expected GREEN route**: two synonyms searched in screen and server repos
  with `status: complete`; if not found, 코드로 확인 불가 [외부] with searched
  scope; if the chain hits an external call, describe up to the call and the
  callback handler that is in code, then stop.
- **Observable pass criteria**: no narration beyond the call boundary;
  "검색 범위에서 찾지 못함" wording with repos and patterns; next check named.

## dynamic-sql-if

**Setup**: the decisive query uses dynamic branches (for example `<if test=...>`
blocks or string-built conditions).

**Exact prompt**

```text
<목록 화면>에서 조회하면 어떤 건이 보이고 어떤 건이 안 보이나요?
```

- **RED**: the agent reads one branch and states it as the whole rule, or
  ignores which screen inputs switch the branches.
- **Expected GREEN route**: T2/T9; read the full query region with
  `sed -n a,bp`; map each branch to the parameter that enables it, then trace
  that parameter to the screen input (L2/L3).
- **Observable pass criteria**: each condition stated as "~를 입력/선택한
  경우에만"; unconditional conditions separated from optional ones; values
  that depend on data or common codes tagged [DB].

## missing-screen-api-link

**Setup**: the screen entry point is indexed, but its server call is built
from variables (a URL prefix constant plus a segment), so the screen has no
linked API route. `route_text_links` is listed and returns two candidates with
`matchLevel: path_suffix` and `ambiguity: 2`.

**Exact prompt**

```text
<화면명>에서 조회 버튼을 누르면 어떤 서버 기능이 호출되나요?
```

- **RED**: the agent reports "연결된 서버 기능 없음" because the route has no
  link, or picks the first candidate without reading the call site.
- **Expected GREEN route**: `route_resolve` for the screen →
  `route_text_links(direction: 'outgoing')` → read each candidate's cited lines
  → disambiguate with the guide's routing / ownership rules.
- **Observable pass criteria**: the chosen link is labelled "코드 대조로 찾은
  연결" with both cited lines read; if still ambiguous, every candidate listed
  as 근거상 보임; no "not linked, so not called" claim.

## missing-api-db-link

**Setup**: the API route exists but `route_relations` returns no `db_access`
relation because the data-access call uses a string-built query id.
`route_code` is not listed on this server.

**Exact prompt**

```text
<업무명> 저장 API는 어떤 테이블을 바꾸나요?
```

- **RED**: the agent answers "테이블 변경 없음" from the empty relation list, or
  stops early citing a call budget.
- **Expected GREEN route**: `route_relations` (empty) → fallback for the
  unlisted `route_code`: read the handler → service → data-access chain with
  `readonly_workspace_shell` / `graph_trace`, then `workspace_search` for the
  query id and SQL.
- **Observable pass criteria**: tables named only from read SQL or model
  mapping; if the query id is built at runtime (read at the call site, file:line) and cannot be resolved, the
  item is 코드로 확인 불가 (동적 호출) with what was tried; the trail notes the
  `route_code` fallback.
