# Impact Dossier

## Evidence And Artifact State

Classify each matrix entry as `confirmed`, `likely`, `candidate`, or `unknown`.
The dossier artifact status is `seeded`, `investigated`, `partial`, or `stale`; source
parity is `confirmed`, `partial`, or `unavailable`.

- `seeded`: retrieval produced a valid packet, but a configured investigation
  axis has not run.
- `investigated`: every configured axis ran and every selected target was
  classified, even where the classification remains likely, candidate, or unknown.
- `partial`: a required axis, exact read, freshness check, or traversal frontier
  could not be completed.
- `stale`: the bound product/story revisions, context freshness, or recorded
  source commits no longer match the current inputs.
- `sourceParity: confirmed`: each hard source claim has a bounded exact source
  read at a recorded commit.
- `sourceParity: partial`: source parity is not confirmed, so do not make hard
  implementation/source claims. Preserve spec- or graph-backed candidates and
  likely claims, assumptions, gaps, and the next exact source reads instead.
- `sourceParity: unavailable`: no configured source-reading surface can confirm
  implementation.

## Impact Evidence Matrix

One evidence-matrix entry per target keeps the evidence boundary co-located.
Compute each stable `evidenceId` as `sha256:<hex>` over the UTF-8 bytes of one
canonical JSON array in this exact order:
`[targetKind, target, direction, affectedEpic, repoId, file, symbol, lineStart,
lineEnd]`. Normalize every string to LF and use the empty string for an
unavailable value before JSON serialization. Do not join values with a delimiter
or locale-sensitive encoding. Reordering rows cannot change an id; changing an
array value creates a new id without tuple-boundary ambiguity.

Treat all nine tuple values as strings. Encode `lineStart` and `lineEnd` as
base-10 decimal strings without leading zeroes; use `""` when either line is
unknown. This fixed digest vector is normative:

```text
["api","POST /campaigns/:id/apply","outbound","EPIC-42","repo-heroines","src/campaign/apply.ts","applyCampaign","120","144"]
sha256:7ea5216a2dc21bca319602d4e0aaaa4be612f865e3b9c28e52d15a199277aab0
```

```text
evidenceId, target, targetKind, direction, affectedEpic, traversalDepth, businessEvidence,
specEvidence, graphEvidence, sourceEvidence, repoId, sourceCommit, file, symbol,
lineStart, lineEnd, matchedQuery, observedBehavior, confidence, missingEvidence,
nextExactRead
```

`observedBehavior` is a short source-grounded statement of what the bounded read
proved. It must not contain a complete source file or an unbounded snippet.

## Affected Code Path Coverage

For every anchor that can produce an implementation claim, add one row. The
goal is to read the complete *known affected path*, not to claim that the whole
repository was read. Follow this order: `document_resolve` selects linked
context; `graph_trace` maps both directions and exposes candidates; `code_search`
finds exact symbols; `readonly_workspace_shell` reads the bounded source.

```text
anchor, resolvedDocuments, graphConfirmed, graphCandidatesOrTruncation,
sourceFilesReadAndRoles, consumersChecked, unreadCandidatesAndReason, status,
nextExactRead
```

- The known path includes the UI/caller or API/event entry, domain or
  orchestration, DB/external boundary, event producers/consumers, and adjacent
  tests, configuration, and migrations when each exists in the bounded path.
- `confirmed-path` means all known boundaries in that path were read at the
  recorded commit. It can support a hard implementation claim.
- `partial-path` means a candidate, consumer, boundary, test/config/migration,
  or source surface remains unread. It supports only a candidate, assumption,
  risk, or evidence-resolution task.
- A graph hop, search hit, or document link is never a replacement for the
  matching exact source read. Empty output is also not evidence of no boundary.

## Stable Impact Revision

`impactRevision` is `sha256:<hex>` over a canonical JSON evidence snapshot. The
snapshot uses these exact top-level keys and no aliases:

```json
{
  "affectedCodePathCoverage": [],
  "contextStatus": "",
  "crossEpicTraversal": {},
  "impactCoverageLimits": [],
  "impactEvidenceMatrix": [],
  "maxCrossEpicDepth": 2,
  "productSegmentRevision": "",
  "projectId": "",
  "sourceCommits": [],
  "sourceParity": "",
  "status": "",
  "storiesRevision": ""
}
```

`sourceCommits` contains exact `{repoId, sourceCommit}` objects sorted first by
`repoId`, then by `sourceCommit`. `impactCoverageLimits` is a sorted set of
strings. `impactEvidenceMatrix` contains the normalized matrix rows sorted by
`evidenceId`. `affectedCodePathCoverage` contains normalized coverage rows
sorted by canonical JSON bytes. `crossEpicTraversal` is the exact canonical
state owned by `cross-epic-traversal.md`: sorted `frontierEpicIds`,
`visitedEpicIds`, `visitedSpecIds`, `visitedGraphSeeds`, and
`visitedCodeQueries`; numeric `currentDepth` and `maxDepth`; sorted
`truncationReasons`; and separate sorted `confirmedEdges`, `likelyEdges`, and
`candidateEdges` arrays. `maxCrossEpicDepth` is the same configured numeric
bound persisted at top level.

Normalize every matrix row as a canonical object containing all documented
fields from the Impact Evidence Matrix contract. In every matrix row, encode an
absent scalar as the empty string `""`, an absent array as `[]`, and an absent
object as `{}`. Normalize strings to LF, sort set-like arrays in UTF-8 bytewise
lexical order, sort nested object keys lexically, and then serialize with the
same canonical JSON rules as the complete snapshot.

The scalar fields are `evidenceId`, `target`, `targetKind`, `direction`,
`affectedEpic`, `traversalDepth`, `repoId`, `sourceCommit`, `file`, `symbol`,
`lineStart`, `lineEnd`, `matchedQuery`, `observedBehavior`, `confidence`, and
`nextExactRead`. Encode numeric scalar fields as base-10 decimal strings without
leading zeroes. The array fields are `businessEvidence`, `specEvidence`,
`graphEvidence`, `sourceEvidence`, and `missingEvidence`; normalize every member
as an LF-normalized string and sort it bytewise. No matrix field changes type
between snapshots.

Normalize every affected-code-path coverage row as a canonical object with
scalar fields `anchor`, `status`, and `nextExactRead`, plus sorted LF-normalized
string arrays `resolvedDocuments`, `graphConfirmed`,
`graphCandidatesOrTruncation`, `sourceFilesReadAndRoles`, `consumersChecked`,
and `unreadCandidatesAndReason`. Use `""` and `[]` for absent values. Sort each
row's canonical JSON byte string in UTF-8 bytewise lexical order before placing
the parsed objects in the snapshot. A changed code-path coverage boundary must
therefore create a new `impactRevision` and downstream evidence fingerprint.

Normalize every directed edge with all owning fields: `sourceEpicId`,
`targetEpicId`, `direction`, `originLayer`, `sourceDocumentId`, sorted
`sourceDocumentIds`, `documentId`, `documentType`, `originalKind`, `derivedKind`,
`role`, `reason`, `confidence`, and sorted `relationIds`. Use the empty string
`""` for every absent scalar and `[]` for every absent array. If traversal state
is absent, persist the required empty arrays, use `currentDepth: 0`, and use
`maxDepth: 2`.

Sort every set-like string array in UTF-8 bytewise lexical order; do not use a
locale-sensitive comparator. Serialize each normalized edge as canonical JSON
with lexically sorted object keys, then sort the edge canonical JSON byte strings
in UTF-8 bytewise lexical order before placing the parsed objects into their
edge bucket. This total order includes array-valued fields and prevents input or
locale order from changing the revision when leading fields tie. Apply the same
canonical JSON key and UTF-8 rules to the complete snapshot.

### Normative calculator

Use the repo-local calculator instead of recreating these rules from memory:

```bash
node scripts/impact-revision.mjs <impact-snapshot-input.json>
```

Pass `--json` to print both the digest and normalized snapshot. The input may
omit `evidenceId`; the calculator derives it from the normative tuple. A
supplied mismatching `evidenceId` is an error. The normalized snapshot printed
by the calculator is the evidence-bearing value that the dossier tables must
represent; a digest without corresponding persisted rows is invalid.

`impactRevision` excludes `impactRetrievedAt`, its own status-table field, and other
write-time timestamps. `impactRetrievedAt` records freshness only, not impactRevision
content. A refresh that changes only `impactRetrievedAt` must retain the same
`impactRevision`; evidence or coverage changes create a new revision.

## Persisted PRD Appendix

Only the selected SDD directory may receive a write or read-back verification.
Persist source evidence by reference only: repo id, source commit, file, symbol,
line range, `matchedQuery`, and short `observedBehavior`; do not persist complete
source files or unbounded snippets.

Store `productSegmentRevision`, `storiesRevision`, `impactRevision`,
`impactStatus`, `contextStatus`, `sourceParity`, `impactRetrievedAt`,
`sourceCommits`, cross-EPIC traversal status, and `impactCoverageLimits` in the
compact status table under PRD `### 9-2. 최신성 및 근거 경계`, not in
frontmatter. The appendix begins
after the completed §0–§8 product body and is the only part of the PRD this
skill may replace.

Use this exact status table key vocabulary:

| key | value contract |
| --- | --- |
| `productSegmentRevision` | `sha256:<hex>`; PRD stable product body revision |
| `storiesRevision` | `sha256:<hex>`; stable stories body revision |
| `impactRevision` | `sha256:<hex>` |
| `impactStatus` | `seeded | investigated | partial | stale` |
| `contextStatus` | current MCP context freshness value |
| `sourceParity` | `confirmed | partial | unavailable` |
| `impactRetrievedAt` | ISO-8601 timestamp |
| `sourceCommits` | repo id and full commit pairs, sorted by repo id |
| `crossEpicTraversalStatus` | completion/truncation state and depth |
| `impactCoverageLimits` | sorted explicit limits or `[]` |

Use these headings verbatim:

```text
## 9. 영향도 조사 및 근거
### 9-1. 조사 기준과 문서 연결
### 9-2. 최신성 및 근거 경계
### 9-3. 관련 EPIC·문서·스펙
### 9-4. 화면·API·데이터 후보
### 9-5. 빠른 경로 지도 (Graph Trace)
### 9-6. 교차 EPIC·저장소·원문 확인
### 9-7. 영향 근거 매트릭스
### 9-8. 조사 한계와 다음 확인
```

`document_resolve`로 선택한 문서 항목과 연결 스펙을 확인한 뒤,
`graph_trace`로 `화면 ↔ API ↔ 도메인 ↔ DB/외부 연동` 경로를 기록한다.
경로 지도에는 시작 앵커, 확인된 홉, 후보/미확인 홉, 누락·절단 정보, 다음 원문
확인을 표로 남긴다. Graph trace만으로 쓰기, 권한, 트랜잭션, 계약, 영향 부재를
확정하지 않는다.

`### 9-6. 교차 EPIC·저장소·원문 확인`에는 앵커별 **영향 코드 경로 읽기 범위** 표를
함께 둔다. 표에는 읽은 파일·심볼과 역할, 확인한 소비자, 미열람 후보와 이유,
`confirmed-path | partial-path`, 다음 원문 확인을 기록한다.

## Completion Gate And Boundary Outcomes

Complete only after every seed has an exact spec or named gap, both graph
directions were attempted, API and screen candidates were classified, confirmed
cross-EPIC evidence reached its bound or kept a frontier, repository scope is
known or a gap, hard claims have bounded source reads, and missing evidence has
a next exact read or coverage limit.

| Boundary | Required outcome |
| --- | --- |
| Missing workspace tools | Name the capability gap and use `partial`; never fall back to local CLI or local SOT. |
| Empty graph | Record the graph coverage limit and candidates or unknowns; never conclude no impact. |
| Truncated graph or omitted classes | Record the omission and truncation reason as a coverage limit. |
| Traversal cycles | Preserve the edge, stop revisiting, and record the cycle/revisit reason. |
| Depth limit with retained frontier | Keep the named frontier and set `partial`. A remaining frontier makes the dossier partial. |
| Excessive grep matches | Record the excessive-match limit, narrow the query, and name the next exact read. |
| Grep without exact source read | Keep the hit as a candidate with the exact source read as next action. |
| Tied repositories | Preserve every tied repository candidate, searched scope, and disambiguation read; set `partial`. |
| Source-commit drift | Record drift and weaken or omit hard claims until a current bounded read; set source parity `partial`. |
| Stale context | Record the freshness gap and prevent hard implementation claims until refreshed evidence exists. |
| Missing explicit cross-EPIC surface | Preserve likely/candidate evidence and the next read; do not claim no cross-EPIC impact. |
| Local write or read-back failure | Stop with the named artifact failure; do not claim the impact artifact persisted. |

Every boundary yields a named gap, limit, candidate, partial status, or stop
condition. Never produce a silent no-impact conclusion.

## Product Approval Impact Gate

When the dossier is embedded in an SDD PRD, every `impactCoverageLimits` entry
must also appear in §9-8 with these fields:

```text
limit, affectedProductIds, approvalImpact(BLOCKING | NON_BLOCKING), nextExactRead
```

Use `BLOCKING` when the missing evidence can change a promised user result,
especially money movement, privileged mutation, permission/ownership,
irreversible state, notification guarantees, persistence, or a new/changed user
surface. Missing a required full-cycle rung such as DESIGN for product flow or
UCL for user action is also BLOCKING when that rung owns the promise. Use
`NON_BLOCKING` only when the product result is already supported and the gap is
an implementation detail safely deferred to technical design.

`impactStatus: partial` is not automatically blocking, but an SDD product pair
with any BLOCKING row cannot report Self Review PASS or request approval. The
owning SDD spec skill must either complete the next exact read or narrow the
product promise and regenerate the revision-bound appendix.
