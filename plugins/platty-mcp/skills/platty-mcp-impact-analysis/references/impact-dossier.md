# Impact Dossier

## Evidence And Artifact State

Classify each matrix entry as `confirmed`, `likely`, `candidate`, or `unknown`.
The dossier artifact status is `seeded`, `investigated`, or `partial`; source
parity is `confirmed`, `partial`, or `unavailable`.

- `seeded`: retrieval produced a valid packet, but a configured investigation
  axis has not run.
- `investigated`: every configured axis ran and every selected target was
  classified, even where the classification remains likely, candidate, or unknown.
- `partial`: a required axis, exact read, freshness check, or traversal frontier
  could not be completed.
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

## Stable Impact Revision

`impactRevision` is `sha256:<hex>` over a canonical JSON evidence snapshot. The
snapshot contains the artifact's evidence-bearing metadata (`status`,
`sourceParity`, `projectId`, `contextStatus`, lexically sorted `sourceCommits`,
and `maxCrossEpicDepth`), lexically sorted coverage-limit strings, canonical
matrix rows sorted by `evidenceId`, and the exact canonical cross-EPIC traversal
state owned by `cross-epic-traversal.md`: sorted `frontierEpicIds`, `visitedEpicIds`,
`visitedSpecIds`, `visitedGraphSeeds`, and `visitedCodeQueries`; `currentDepth`;
`maxDepth`; sorted `truncationReasons`; and separate sorted `confirmedEdges`,
`likelyEdges`, and `candidateEdges` arrays.

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

`impactRevision` excludes `retrievedAt`, its own frontmatter field, and other
write-time timestamps. `retrievedAt` records freshness only, not impactRevision
content. A refresh that changes only `retrievedAt` must retain the same
`impactRevision`; evidence or coverage changes create a new revision.

## Persisted `impact.md`

Only the selected SDD directory may receive a write or read-back verification.
Persist source evidence by reference only: repo id, source commit, file, symbol,
line range, `matchedQuery`, and short `observedBehavior`; do not persist complete
source files or unbounded snippets.

```yaml
---
id: "<impact-id>"
type: "sdd-impact"
status: "seeded | investigated | partial"
impactRevision: "sha256:<hex>"
sourceParity: "confirmed | partial | unavailable"
projectId: "<projectId>"
outputLanguage: "<language>"
contextStatus: "fresh | stale | unknown"
sourceCommits: {}
retrievedAt: "<ISO timestamp>"
maxCrossEpicDepth: 2
---
```

Use these headings verbatim:

```text
# Impact Analysis - <Request title>
## 1. Seed and Interpretation
## 2. Freshness and Evidence Boundary
## 3. Selected EPICs and Specs
## 4. API and Screen Candidates
## 5. Cross-EPIC Traversal
## 6. Graph Impact
## 7. Repository Search
## 8. Source Evidence
## 9. Impact Evidence Matrix
## 10. Coverage Limits
## 11. Next Exact Reads
```

## Compact Request Handoff

Keep this compact Engineering Discovery Handoff as an in-memory/reference
contract that the SDD spec flow may copy later when it owns the request. Impact
analysis must not mutate `request.md`:

```markdown
## Engineering Discovery Handoff

- **Impact artifact**: `impact.md`
- **Impact status**: <seeded | investigated | partial>
- **Source parity**: <confirmed | partial | unavailable>
- **Seed EPICs**: <ids and names>
- **Seed specs**: <ids and kinds>
- **Context freshness**: <fresh | stale | unknown>
- **Source commits**: <repo id -> commit>
- **Coverage limits**: <short summary or none>
```

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
