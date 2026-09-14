---
name: planning-context
description: Establish a BA planning context for Heroines: problem, goal, users, solution intent, scope, rules, and success criteria. Use only while the interview session stage is planning_context.
---

# BA Planning Context

Run only when `session.py status` reports `stage=planning_context`.

## Question manifest

Before each question, create a manifest that names `stage=planning_context`, the active issue, the evidence used, and one intent: `problem`, `goal`, `users`, `solution`, `scope`, `rules`, or `success`.

Do not ask about message layout, animation, CTA placement, scrolling, or screen elements. Carry those as later-stage candidates after the planning context is confirmed.

## Completion

Update the planning artifact and its assessments after every answer. Ask a `confirmation` only when validation reports `ready_for_confirmation`. Confirm, render the planning result, then let the orchestrator start `user_experience`.

Use the packaged session controller and this skill as the stage contract.
