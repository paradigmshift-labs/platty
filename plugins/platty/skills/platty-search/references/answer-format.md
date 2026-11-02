# English answer format

Use two layers: a short answer for the reader, followed by an inspectable
developer appendix. State the selected project and analyzed-source basis once.
Do not describe an analysis snapshot as today's production behavior.

## Reader summary

1. **Answer:** directly answer the question in one or two sentences.
2. **What to do / conditions:** use verified business labels and plain English.
   Combine screen and server conditions so passing a screen check is not
   mistaken for permission to save.
3. **Other paths:** describe inspected alternatives when relevant.
4. **Needs confirmation:** name runtime values, permissions, policy, or unread
   evidence that could change the answer.

Keep technical identifiers in the appendix, except an exact API/file/column
the developer explicitly named may identify the target in the opening sentence.
Preserve original UI labels; an English gloss is a translation, not an official
menu or screen name. Do not invent a screen title or translate identifiers.
An error ID alone does not reveal the message text shown to a user.

Use only applicable parts; a simple document lookup does not need empty tables.
A behavior or change-impact investigation retains its evidence and gaps.

## Developer appendix

**Evidence**

| Claim | Confidence | Source: repository/path:start-end | Entry point / candidate |
| --- | --- | --- | --- |

Every factual summary statement must have a supporting row. Use these labels:

- `Confirmed`: directly read source supports that precise claim. A statement
  about execution also needs registration/call and branch evidence.
- `Document only`: an authored/generated item was read but its source was not
  independently confirmed. Keep its identity/status and say so.
- `Inference`: a bounded conclusion with a stated outside-code assumption.
- `Unverified`: unread, unavailable, or not found. Unread code is not inference.

Include identifiers, exact code values, all written tables and SQL IDs, and
the relevant SET/WHERE or guard expressions. Split mixed-confidence claims.
Avoid ellipses in repository/file citations and never fabricate line numbers.

**Related entry points**

| Entry point and repository | Role | Effect or unknown | Reading state | Source ranges |
| --- | --- | --- | --- | --- |

Then include the data-item and root-call inventories, investigation scope,
candidate statuses, and the claim audit. Each relevant trigger/guard/alternative
is read, justified as excluded, or explicitly left unread/unavailable. Keep
downstream effects visible. Do not describe the behavior of a listed-only row.

**Scope and claim audit**

Record connection/project, analysis date/revision when known, exact query
patterns and globs, repository scope/completion, W1 table coverage, W1b,
iterations, cursors/truncation, and review outcome. Negative claims and exact
totals require their own audit row:

| Claim type | Required evidence |
| --- | --- |
| Absence / only / all | Complete relevant scope; write verbs and multiline forms; callers/consumers; all candidate branches accounted for |
| Exact count | Definition of the counted set, exact source/tool count and listed members agreeing |
| Execution / retry / rollback | Active entry/call line, complete relevant branch, callee behavior, and caller handling of exceptions/error values |
| UI availability | Activation, visibility and permission evidence; source-defined functions alone are insufficient |

If those requirements are unmet, qualify the claim to inspected scope or move
it to unverified findings. `complete=false`, `truncated=true`, a lower-bound
count, an error, or unread pages never proves absence.

**Unverified findings**

For each gap state what is unknown, why, and the code location or authorized
owner/source that could settle it. Distinguish menu data, scheduler imports,
production values, and unavailable source from unrelated connection failures.
If a question needs live data, say that source retrieval cannot supply that
value; give the inspected storage location/logic instead.

When a date condition matters, retain its operator, distinguish start/end/
eligibility windows, and name the relevant date and current date. Do not turn
a past start date into an assertion that a feature has ended.

For impact answers, group results by online screens, automated jobs, and
external integrations. For an explicit design request, label statements as
`Fact`, `Proposal`, or `Assumption` using [design](design.md).
