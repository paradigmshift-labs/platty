---
name: ba-interview
description: Orchestrate a BA interview through planning context, user experience, screen behavior, and verified wireframes. Use to start or resume an interview; it routes to exactly one current stage.
---

# BA Assistant Orchestrator

Own session routing and stage transitions. Do not perform a stage's detailed interview work here.

## Route

1. Use `scripts/session.py list` to locate or create the live case. Preserve the user's original text in an input file.
1. Read `status --map` to re-enter: it gives the destination, the decisions already made, what is takeable now, what is blocked, the fog and the out-of-scope list, within a fixed budget whatever the artifact weighs.
2. Read `status`. If there is a pending question, record the answer first. If the phase is `process_answer` or `action_required`, finish the current stage work before asking again.
3. Route by `status.stage` only:
   - `jtbd` → [BA JTBD](../platty-mcp-ba-jtbd/SKILL.md)
   - `prd` → [BA PRD](../platty-mcp-ba-prd/SKILL.md)
   - `user_experience` → [BA User Experience](../platty-mcp-ba-user-experience/SKILL.md)
   - `screen_behavior` → [BA Screen Behavior](../platty-mcp-ba-screen-behavior/SKILL.md)
   - `design_system_wireframe` → [BA Design System Wireframe](../platty-mcp-ba-design-system-wireframe/SKILL.md)
   - `planning_context` → [BA Planning Context](../platty-mcp-ba-planning-context/SKILL.md) (read-only; kept for cases opened before the jtbd stage)
4. The selected stage owns its artifact updates, qualitative assessment, and its confirmation.
5. When status is `start_*`, run `session.py start --stage ...` and route to that next stage in the same turn. Do not infer a stage transition from a user saying “continue”.
   6. When a stage needs Platty facts, use [BA Platty Retrieval](../platty-mcp-ba-platty-retrieval/SKILL.md). Keep raw MCP responses in the retrieval subagent and consume only its Evidence Packet.

## Question gate

Questions live in the planning stages only. The controller holds the budget per stage, so do not
carry one stage's allowance into another.

| stage | interview questions |
| --- | --- |
| `jtbd` | uncapped — the interview is the point |
| `prd` | 2 — the Product Discovery Budget |
| `user_experience`, `screen_behavior`, `design_system_wireframe` | **0** — derived; `ask --kind interview` is refused |

**사람이 멈추는 곳은 셋이다** — `jtbd`·`prd`, 그리고 4단계 와이어프레임. 2·3단계는
준비되면 스스로 확정하고 다음 단계를 낸다. 4단계는 질문은 안 하지만 캡처를 사람이 본다. 파생 단계가 행을 도출할 수 없으면 판단을 가진
단계로 backflow를 기록하며, 기획자에게 묻지 않는다.

For live interviews, every `ask` requires `--question-stage` equal to the current `status.stage`.
A question manifest must contain the current stage, one allowed stage intent, its active issue,
evidence IDs, the selecting decision ID, and the exact question text.

## Persist and finish

- Read one slice, not the artifact. `session.py show --issue <id> --with-evidence` returns an issue and the rows it reaches; `--pointer`, `--cell SCOPE:DIMENSION`, `--frontier` and `--decisions` cover the rest. Each result reports the `bytes` it cost.
- Persist a changed draft after each answer before creating the next question. Use `session.py patch --pointer` and send only the changed slice; `save --draft` is for the first draft and for structural rewrites. Both run the same validation, so patch narrows what you write, not what is checked.
- Cite the facts a stage needs in `sources[].excerpt` and reference the original by path and revision. The controller rejects a new or changed excerpt over 1000 characters.
- Use a new decision record for the action it selects; do not reuse a decision ID for unrelated questions.
- Request final confirmation only with `ask --kind confirmation` when the stage validator reports `ready_for_confirmation`.
- Run `assert-yield` before responding. Yield only on a saved pending question, waiting, paused, complete, or a recorded handoff.
- Keep a ticket's scratch in `work/<issue-id>/` and promote anything worth keeping into the artifact or `evidence/`. `handoff` reports the directories whose ticket is closed; `--clean` removes them.
- End the session at its boundary. When `status` reports `should_handoff`, run `handoff` (with `--note` for what only this session knows) and stop; the next session re-enters with `status --map`. A closed ticket or an over-budget session triggers this; a closed lookup does not, because its context stayed in the retrieval subagent.

## Shared references

- [Session controller](scripts/session.py) is the command contract; use its `--help` for arguments.
- The packaged stage skills above define the stage contracts and ownership model.
