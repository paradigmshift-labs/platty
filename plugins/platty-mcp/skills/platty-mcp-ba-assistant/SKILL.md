---
name: ba-interview
description: Orchestrate a BA interview through JTBD, PRD, user experience, storyboard and Notion delivery, screen behavior, and verified wireframes. Use to start or resume an interview; it routes to exactly one current stage.
---

# BA Assistant Orchestrator

Own session routing and stage transitions. Do not perform a stage's detailed interview work here.

## Required Sub-Skills

1. Use `platty-mcp:ba-retrieval` for all existing-service evidence gathering.
   It owns tool selection, project resolution, freshness, and the map-first or
   direct-first retrieval route. The BA flow consumes only its bounded evidence
   output; it does not recreate retrieval logic or substitute local evidence.
2. Use `platty-mcp:platty-mcp-impact-analysis` only when a concrete proposed change needs
   an impact packet to resolve BA scope or a service-boundary decision.

## Runtime-neutral skill dispatch

Invoke the packaged sub-skill directly. On Codex, load the named `SKILL.md`
through its native skills facility. On Claude, invoke the same named skill with
the native `Skill` facility. Do not recreate a child skill's workflow in this
orchestrator; the invoked skill owns its own prerequisites and routing.

1. Invoke `platty-mcp:ba-retrieval` directly with the BA retrieval brief:
   selected `projectId`, current stage, question, required evidence, and case
   path.
2. If retrieval returns a capability gap, record the returned gap in the case
   and stop. Do not create a local fallback.
3. Invoke `platty-mcp:platty-mcp-impact-analysis` directly only for the scoped
   impact case defined above.

## Route

1. Use `scripts/session.py list` to locate or create the live case. Preserve the user's original text in an input file.
1. Read `status --map` to re-enter: it gives the destination, the decisions already made, what is takeable now, what is blocked, the fog and the out-of-scope list, within a fixed budget whatever the artifact weighs.
2. Read `status`. If there is a pending question, record the answer first. If the phase is `process_answer` or `action_required`, finish the current stage work before asking again.
3. At every BA case entry — a newly created case or a re-entry after handoff —
   invoke `platty-mcp:ba-retrieval` directly with the selected `projectId`,
   current stage, case path, and baseline service-evidence need. This is
   required regardless of `status.phase`; `prepare_context` is a status, not a
   retrieval gate. If it returns a capability gap, preserve the case as waiting
   and report the exact configuration gap. Do not recreate the capability gate,
   inspect host configuration, probe endpoints, or use a local Platty CLI
   fallback. Do not repeat this baseline lookup for every answer in the same
   active case; retrieve again only when the stage needs fresh or additional
   service facts.
4. Route by `status.stage` only after the entry retrieval succeeds:
   - `jtbd` → `platty-mcp:jtbd`
   - `prd` → `platty-mcp:prd`
   - `user_experience` → `platty-mcp:user-experience`
   - `screen_behavior` → `platty-mcp:screen-behavior`
   - `design_system_wireframe` → `platty-mcp:wireframe` (also owns the Figma export that `phase: export_figma` requires)
   - `planning_context` → `platty-mcp:planning-context` (read-only; kept for cases opened before the jtbd stage)
5. The selected stage owns its artifact updates, qualitative assessment, and its confirmation.
6. Handle the user-experience delivery phases below before stage transitions. When status is `start_*`, run `session.py start --stage ...` and route to that next stage in the same turn. Do not infer a stage transition from a user saying “continue”.
7. When a stage needs Platty facts beyond the entry baseline, invoke
   `platty-mcp:ba-retrieval` directly and consume only its bounded evidence
   output.

## User-experience delivery

The flow is JTBD → PRD → confirmed user experience → storyboard → Notion publication
→ deliver the HTML and document links → screen behavior → wireframe → Figma.
These are delivery tasks, not new BA interview stages. Reuse the existing skills unchanged:
the orchestrator owns dispatch, input context, delivery receipts, and the screen-start gate.
The child skills own their existing generation and publication workflows; do not add
controller-specific prerequisites, receipt commands, or retry behavior to those skills.
For storyboard eligibility, the confirmed UX case is at the boundary that previously emitted
`start_screen_behavior`; `deliver_storyboard` is that same boundary with delivery still owed.
Pass the planner's requested publication scope and selected parent to notion-publish as its
invocation context. Keep its existing destination search and selection procedure.

- `deliver_storyboard`: invoke `platty-mcp:storyboard` with the case and confirmed inputs.
  Record the spec and generated HTML through the controller, including missing-image limits.
- `publish_notion`: invoke `platty-mcp:notion-publish` for the case. This workflow explicitly
  includes publishing the three confirmed documents; a second request to publish is unnecessary.
  Use an explicitly supplied parent. If no parent is selected, show at most three candidates,
  record a delivery waiting state, and ask for the destination. This is an operational choice,
  not an interview question and does not consume PRD discovery budget.
- `deliver_results`: rebuild the storyboard with the published document URLs, show the final
  standalone HTML and bundle/child links in commentary, and record that delivery through the
  controller. If publication has a recorded capability gap, show the local HTML and exact gap.
  Only then start screen behavior. Presentation is not another planner confirmation.

Read `delivery-status` on resume. Use `delivery-record` to save each receipt immediately;
record completed page IDs one by one. See `session.py delivery-record --help` for the command
contract. The orchestrator saves receipts from the existing skills' actual outputs. It also
checkpoints each returned Notion page ID before proceeding to the next creation. On resume,
pass saved bundle/child IDs and remaining work to notion-publish; do not rerun a completed
publication sequence. Keep the client retry policy unchanged.
An **uncertain** creation result remains `waiting` until a returned page link or a verified
check of the selected parent resolves it. A destination selection alone does not resolve
uncertainty. Record capability failures as gaps in the caller; the child skill still stops
according to its own instructions.
Reuse current receipts, resolve uncertain creates before another invocation, and regenerate
stale outputs from current confirmed inputs. Never write the delivery record by hand.
Receipt commands (use the current `input_hash` returned by `delivery-status`):

```text
session.py delivery-status <case>
session.py delivery-record <case> --step storyboard --status complete --input-hash <hash> --spec <spec.json> --html <standalone.html>
session.py delivery-record <case> --step notion --status waiting --input-hash <hash> --parent-page-id <parent> --checkpoint bundle:<page-id>:<url> --reason "partial publication; children remain"
session.py delivery-record <case> --step notion --status complete --input-hash <hash>
session.py delivery-record <case> --step results --status complete --input-hash <hash> --html <standalone.html> --url <bundle-url>
```

Record each child with `--checkpoint jtbd:...`, `prd:...`, or `user_experience:...` before
marking Notion complete. Use `--status gap --reason ...` only for a publication capability gap;
storyboard generation failures remain `waiting`. Missing images use placeholders in usable HTML.
A recorded handoff does not fulfill delivery; the next session resumes the pending step.
Existing cases without delivery tracking are not published merely by opening them; explicit
`delivery-start` opts a previously confirmed UX case into this flow.

## Question gate

Questions live in the planning stages only. The controller holds the budget per stage, so do not
carry one stage's allowance into another.

| stage | interview questions |
| --- | --- |
| `jtbd` | uncapped — the interview is the point |
| `prd` | 2 — the Product Discovery Budget |
| `user_experience`, `screen_behavior`, `design_system_wireframe` | **0** — derived; `ask --kind interview` is refused |

**사람이 멈추는 곳은 둘이다** — `jtbd`·`prd`. 2·3·4단계는 준비되면 스스로 확정한다.
4단계는 `wireframe.py sync`가 모든 타깃 `accept_ai`에 닿으면 컨트롤러가 확정하고,
확정 기록은 기획자가 보지 않았다고 스스로 적는다. 파생 단계가 행을 도출할 수 없으면 판단을 가진
단계로 backflow를 기록하며, 기획자에게 묻지 않는다. 파생 단계에서 `ask --kind confirmation`은
거부된다 — 확정을 되돌리려면 `reopen --stage <단계>`를 쓴다.

For live interviews, every `ask` requires `--question-stage` equal to the current `status.stage`.
A question manifest must contain the current stage, one allowed stage intent, its active issue,
evidence IDs, the selecting decision ID, and the exact question text.

## Case folder layout

A new case is written in stage folders; find a stage's output in its folder, and start from `INDEX.md`.

```text
<case>/session.json        controller state (stays at the root)
<case>/INDEX.md            each stage's status and files, latest Figma link
<case>/00-input/           the planner's original input
<case>/01-jtbd/  02-prd/  03-user-experience/  04-screen-behavior/
<case>/05-wireframe/       runs/<run>/  canonical-details/  screens/<screen>/  figma/
<case>/evidence/           audit records only: trace, tool-events, decisions, validations
<case>/handoffs/  work/<issue-id>/
```

Each stage folder holds its artifact, its render and progress files, and its `snapshots/`.
A case created before stage folders (no `layout` in `session.json`) keeps its flat layout and runs
unchanged. Never build these paths by hand in commands or artifacts — the controller and engine
resolve them.

The `.json` is the record; the `.md` beside it is the reading document the controller writes when
the stage completes. For user experience, screen behavior and wireframe it opens with a summary,
follows the journey's order, and links across stages (journey step → screen → render case →
capture → Figma frame); coverage, reviews, upstream codes, runs and hashes go to
`<stage>-review.md` beside it. Never hand-edit either file — change the artifact. To rewrite the
documents of a finished case from its artifacts, run `session.py render-docs <case>`; it changes no
artifact.

## Persist and finish

- Read one slice, not the artifact. `session.py show --issue <id> --with-evidence` returns an issue and the rows it reaches; `--pointer`, `--cell SCOPE:DIMENSION`, `--frontier` and `--decisions` cover the rest. Each result reports the `bytes` it cost.
- Persist a changed draft after each answer before creating the next question. Use `session.py patch --pointer` and send only the changed slice; `save --draft` is for the first draft and for structural rewrites. Both run the same validation, so patch narrows what you write, not what is checked.
- Cite the facts a stage needs in `sources[].excerpt` and reference the original by path and revision. The controller rejects a new or changed excerpt over 1000 characters.
- Use a new decision record for the action it selects; do not reuse a decision ID for unrelated questions.
- Request final confirmation only in `jtbd` and `prd` (and a retired `planning_context` case), only with `ask --kind confirmation`, and only when the stage validator reports `ready_for_confirmation`. Derived stages complete themselves.
- Run `assert-yield` before responding. Yield only on a saved pending question, waiting, paused, complete, or a recorded handoff.
- Keep a ticket's scratch in `work/<issue-id>/` and promote anything worth keeping into the artifact or `evidence/`. `handoff` reports the directories whose ticket is closed; `--clean` removes them.
- End the session at its boundary. When `status` reports `should_handoff`, run `handoff` (with `--note` for what only this session knows) and stop; the next session re-enters with `status --map`. A closed ticket or an over-budget session triggers this; a closed lookup does not, because its context stayed in the retrieval subagent.

## Shared references

- [Session controller](scripts/session.py) is the command contract; use its `--help` for arguments.
- The packaged stage skills above define the stage contracts and ownership model.
