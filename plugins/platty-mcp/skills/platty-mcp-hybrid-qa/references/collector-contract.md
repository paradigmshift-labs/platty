# Collector Contract

Shared by the docs collector, the code collector, the Codex native
(`spawn_agent`) collector workers, and the sequential in-session fallback. A collector gathers evidence for one Job Card (one question or
sub-question, one track) and returns ONLY one JSON object — no prose before or
after it, no Markdown fence.

## Input: Job Card

```text
job: Q<n>[.<k>]-<docs|code>
question: <raw question or sub-question>   parent: <raw Q<n> when split>
track: docs | code
business words: <menu, button, state, message, document names>
link: <impact link jobs only: db | job/event | client | settlement | notification/external>
sweeps: <impact jobs only: the sweeps this job owns (S1..S7)>
Session Card: projectId, tool-name prefix map, tracks, documentAvailability,
  code Session Map (repo sets + repoIds, exclusion globs, route tools listed),
  guide availability
Guide Brief: the operator code environment guide sections relevant to this
  job, each headed "guide:<section>" (repo roles and ownership, layer
  conventions, matching recipe, exclusion globs, mirror rules, appendix rows)
```

Read-only rule: a collector never writes files and never calls a mutation tool.
On Claude Code the plugin hook enforces this; on Codex native workers
(`spawn_agent`) no hook applies, so the spawn prompt states it explicitly and
the Codex worker must not write files or call Memory request, alias write, or
any other write tool, and must not use a local CLI or host shell.

Use the Session Card and Guide Brief as given: do not rerun `context_status`.
Call `code_search_guide_get` only when the Guide Brief is insufficient or
missing a section the ladder needs (for example the recipe for a different
question type), read only what is needed, and say so in `gaps`
("guide brief insufficient: read <section>"). Call tools by the exact host
names in the prefix map.

## Output: JSON Schema

```json
{
  "question": "Q<n>[.<k>]",
  "track": "docs | code",
  "audience": "non-developer | developer",
  "calls": 0,
  "claims": [
    {
      "claim": "<one plain sentence; names the endpoint, screen, or version it describes>",
      "level": "확인됨 | 근거상 보임 | 불가",
      "appliesTo": "<optional: endpoint / API generation / screen / batch the claim describes, e.g. 'v2 POST /point/x'>",
      "link": "<impact jobs: screen | api | service | db | event | job | settlement | notification | external | client>",
      "sweep": "<impact jobs: the sweep that found it, S1..S7>",
      "reason": "<required when level is 불가: [DB] | [외부] | [런타임] | [신규] | searched scope>",
      "evidence": [
        { "ref": "<docs: family:documentId/itemId or spec:specId/claims.<i>; code: repo:path:line[-line]>", "quote": "<≤200 chars, verbatim>" }
      ]
    }
  ],
  "gaps": ["<what was not found or not checked, with searched scope; links the documents never state>"],
  "sweeps": [
    { "sweep": "S1..S7", "status": "done | partial | not-applicable", "coverage": "<name forms and patterns, tools, repos, per-repo status>", "open": ["<what remains when partial>"] }
  ],
  "slowCalls": [{ "tool": "<host tool name>", "ms": 0 }]
}
```

- `audience`: optional; echo the Job Card's `audience` unchanged. The collector
  never decides or changes it; the orchestrator passes the resolved audience to
  the synthesizer separately.
- `calls`: number of MCP tool calls this job made.
- `slowCalls`: calls that took 10 s or longer, timed out, or were truncated
  (add `"note": "timeout" | "truncated"`).
- Every claim has at least one evidence entry; a claim without evidence is not
  a claim — move it to `gaps`.
- `link`, `sweep`, and `sweeps` are required for impact jobs (change-impact,
  regression, bug-cause, A-to-Z, direct data edit questions, or a Job Card
  that names `link` or `sweeps`) and omitted otherwise. `link` is one of
  `screen | api | service | db | event | job | settlement | notification |
  external | client`; the synthesizer builds the 영향 체인 지도 rows from it.
- `sweeps` has one entry per sweep the job owns. `done` needs a `coverage`
  that names what was searched (every name form, repos, per-repo status);
  `partial` lists in `open` what is not yet checked; `not-applicable` says why
  in `coverage`. A sweep with no entry counts as not run.

## Quote Rules

- `quote` is verbatim, at most 200 characters, copied from the read document
  item or source line. Never paraphrase or summarise inside `quote`; cut long
  text with `…` at a boundary that keeps the asserted part.
- The quote must contain the part the claim asserts (the value, condition,
  state, or endpoint). If the asserted part lies outside 200 characters, add a
  second evidence entry rather than citing a cut-off quote.
- Code refs cite the line actually read; ranges as `path:42-47`.
- Guide refs: a fact taken from the code environment guide is cited as
  `"ref": "guide:<section>"` with a verbatim quote from the brief or guide.

## Guide Evidence

The guide scopes the search (where to look, which repo owns what, which paths
are noise) and gives vocabulary and code meanings. It is not behaviour
evidence. Behaviour claims (what the system does, values it enforces, records
it writes) still need a source line or document item quote; a claim backed
only by guide refs is at most 근거상 보임, never 확인됨. Appendix dictionaries
(code value → meaning, status code or message code tables, menu → screen
tables) are cited as 근거상 보임. A code label or constant name in source (an
SQL `CASE` label, an enum or constant name) does not confirm a business
meaning either: it stays 근거상 보임, as in `platty-mcp-code-qa`. Only a read
data row that defines the code (for example a common-code table row returned
by a read-only MCP tool) can raise the meaning above 근거상 보임; otherwise the
official meaning is tagged [DB] under 추가 확인 필요.

## Level Rules

| Level | Docs track | Code track |
| --- | --- | --- |
| 확인됨 | The exact document item or spec claim was read (`<family>_item_get`, `<family>_get`, `spec_get`) and the quote states the claim. | The source line was read with `readonly_workspace_shell`, or the `platty-mcp-code-qa` single-line `확인됨 (검색 원문)` exception applies. |
| 근거상 보임 | Only a search hit, a summary card, an unresolved evidence marker, naming, or an inference across items supports it. | Only a search hit, route relation, graph edge, or naming supports it. |
| 불가 | The documents do not answer it (state the searched scope). | Code cannot answer it; add the `platty-mcp-code-qa` reason tag. |

- Absence is never 확인됨. "There is no API / rule / deletion for X" is
  근거상 보임 with the searched scope (tools, patterns, repos or families,
  status), or 불가.
- An evidence entry the tool itself marks unresolved or inferred is at most
  근거상 보임.

## Version and Link Rules

- Legacy versus current: APIs often exist in several generations (v1, v1.1,
  v2, admin and app variants). Every claim names the endpoint or generation it
  describes in `claim` or `appliesTo`. A document item about a legacy endpoint
  must not be generalised as current behaviour; when the generation is unclear,
  say so in `appliesTo` and add a gap.
- Screen→API links: a document that describes a screen and, separately, an API
  does not prove that the screen's button calls that API. Never guess or infer
  the link; state it only when one read item or source line names both ends.
  Otherwise record "screen <x> → API: link not stated" in `gaps`.
- Numbers: when a document names a constant without its literal value, report
  the name and put "literal value not in documents" in `gaps`; do not borrow a
  value from memory.

## Track Rules

- **docs track**: follow the `platty-mcp-retrieval` ladder (project and EPIC
  map, typed business documents, exact items, connected specs, memory
  overlays). Open full items only for the items you cite. Do not call
  `workspace_search`, `code_search`, or `readonly_workspace_shell`: source
  reads belong to the code track. A spec's handler file may be named in `gaps`
  as a pointer.
- **code track**: follow the `platty-mcp-code-qa` ladder — Question Card,
  Evidence Ladder, Missing-Link Ladder, mandatory fallbacks, honesty levels,
  secrets rule. Do not read business documents. Map `확인됨 (검색 원문)` to
  `확인됨` with that line as the quote. Impact jobs run the sweeps named in the
  Job Card from `code-qa-recipes.md` "Impact Sweeps (S1–S7)". Follow the
  `readonly_workspace_shell` input rules in that file's Search Patterns
  (no `$`, `;`, `&`, `<`, `>` or backticks even inside quotes; alternation with
  repeated `-e`; no pattern or path starting with `/`; cwd-relative paths).
- Tool inputs: `view` (`"summary"` or `"full"`) is accepted only by
  `project_get`, `epic_get`, `business_rule_get` and `spec_get`; no other tool
  takes it, and passing it returns `INVALID_INPUT` ("not an argument of this
  tool"). Send `view: "summary"` to the first three; `spec_get` already answers
  with the summary by default.
- Spec claims: the `spec_get` summary holds one page of claims (nearest the
  handler first) and `claimFiles` indexing every claim location. Page with the
  returned `claimCursor` continuation or read one file with `claimPath`, rather
  than `view: "full"`. If a `spec_get` result is still too large to read (the host
  saves an oversized result to a file the collector cannot open), fall back to
  `spec_search` claim-level hits for the asserted part (근거상 보임 at most) and
  add a gap naming the spec and what was not read.
- Both tracks: no per-question call or time budget; apply the
  `platty-mcp-code-qa` loop guard (no identical search; three consecutive
  searches with nothing new for an open item → conclude it as a gap).

## Example (placeholders)

```json
{"question":"Q<n>","track":"code","calls":<k>,"claims":[
 {"claim":"<current endpoint> returns 0 points instead of an error once the daily total reaches the limit.","level":"확인됨","appliesTo":"<v2 METHOD /path>",
  "evidence":[{"ref":"<repo>:<path>:<L>","quote":"if (<todayTotal> >= <LIMIT_CONSTANT>) {"},
              {"ref":"<repo>:<path>:<L>","quote":"return { <earned>: 0 };"}]}],
 "gaps":["<legacy endpoint> behaviour not read"],
 "slowCalls":[]}
```

Impact link job (placeholders):

```json
{"question":"Q<n>.db","track":"code","calls":<k>,"claims":[
 {"claim":"<batch name> writes rows of <table> after <event>.","level":"확인됨","appliesTo":"<job route>","link":"job","sweep":"S1",
  "evidence":[{"ref":"<repo>:<path>:<L>","quote":".insertInto('<table>')"}]}],
 "gaps":["S3: <scheduler registration file> not read"],
 "sweeps":[
  {"sweep":"S1","status":"done","coverage":"<Model>, <table_name>, <tableNames>: all repos, complete","open":[]},
  {"sweep":"S3","status":"partial","coverage":"route_resolve kinds job/event with <domain word>","open":["<scheduler decorator> search not run"]}],
 "slowCalls":[]}
```
