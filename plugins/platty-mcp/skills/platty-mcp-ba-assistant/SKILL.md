---
name: ba-interview
description: Orchestrate a BA interview through planning context, user experience, screen behavior, and verified wireframes. Use to start or resume an interview; it routes to exactly one current stage.
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
6. When status is `start_*`, run `session.py start --stage ...` and route to that next stage in the same turn. Do not infer a stage transition from a user saying “continue”.
7. When a stage needs Platty facts beyond the entry baseline, invoke
   `platty-mcp:ba-retrieval` directly and consume only its bounded evidence
   output.

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
